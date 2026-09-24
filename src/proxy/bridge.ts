// src/proxy/bridge.ts

/**
 * Bridge between the proxy's front-facing MCP server and the real
 * MCP server behind it.
 *
 * Responsibility: wire `server.ts` callbacks to `client.ts` methods,
 * consult `fault-runtime.ts` before every `tools/call`, and record
 * tool calls into a trajectory.
 *
 * This is the *only* module that knows about both sides of the proxy.
 * server.ts and client.ts stay single-purpose.
 *
 * Fault injection honors two modes:
 *   - `instead` : return the synthetic result, do NOT forward
 *   - `after`   : forward to the real server FIRST, then replace
 *                 the response with the synthetic one
 *
 * The `after` mode is what makes idempotency violations observable
 * through the proxy: the real write happens, but the agent sees a
 * timeout and retries.
 */

import type { CallToolRequest, ListToolsRequest } from '@modelcontextprotocol/sdk/types.js';

import type { ToolCallRecord, ToolCallResult } from '../mcp/types.js';
import type { ProxyClientHandle } from './client.js';
import type { ProxyServerHandle } from './server.js';
import { createProxyServer } from './server.js';
import type { FaultRuntimeHandle } from './fault-runtime.js';
import type { ProxyConfig, ProxyEvent, ProxyFaultRecord } from './types.js';

// ---------------------------------------------------------------------------
// Options & handle
// ---------------------------------------------------------------------------

export type BridgeEvent = Omit<ProxyEvent, 'index' | 'timestamp'>;

export interface BridgeOptions {
  readonly config: ProxyConfig;
  readonly client: ProxyClientHandle;
  readonly faultRuntime: FaultRuntimeHandle;

  /** Called for every event produced by server, client, or bridge. */
  readonly onEvent: (event: BridgeEvent) => void;
}

export interface BridgeHandle {
  readonly server: ProxyServerHandle;
  /** All tool calls observed, in order. */
  readonly toolCalls: readonly ToolCallRecord[];
  /** All faults injected, in order. */
  readonly faults: readonly ProxyFaultRecord[];
  /** Resolves when either side closes. */
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function emit(
  onEvent: (event: BridgeEvent) => void,
  event: BridgeEvent
): void {
  try {
    onEvent(event);
  } catch {
    // A broken sink must not take down the bridge.
  }
}

/**
 * Track per-tool call counts so fault-runtime can use 1-based
 * `call_number` semantics (same as the embedded injector).
 */
function makeCallCounter(): {
  next(toolName: string): number;
} {
  const counts = new Map<string, number>();
  return {
    next(toolName: string): number {
      const n = (counts.get(toolName) ?? 0) + 1;
      counts.set(toolName, n);
      return n;
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createBridge(opts: BridgeOptions): Promise<BridgeHandle> {
  const { config, client, faultRuntime, onEvent } = opts;

  const toolCalls: ToolCallRecord[] = [];
  const faults: ProxyFaultRecord[] = [];
  const counter = makeCallCounter();

  // --- tools/list: pass straight through to the real server -----------
  async function handleListTools(_request: ListToolsRequest): Promise<unknown> {
    const result = await client.client.listTools({});
    return result;
  }

  // --- tools/call: consult fault-runtime, then forward or inject ------
  async function handleCallTool(request: CallToolRequest): Promise<unknown> {
    const toolName = request.params.name;
    const args = request.params.arguments ?? {};
    const callNumber = counter.next(toolName);
    const startedAt = Date.now();

    // 1. Ask fault-runtime whether to inject.
    const decision = faultRuntime.decide({
      toolName,
      args,
      callNumber,
    });

    let result: ToolCallResult;
    let durationMs: number;
    let executed: boolean;

    if (decision.inject && decision.mode === 'instead') {
      // ─── Mode 'instead': short-circuit, do NOT call the real server ───
      result = decision.result;
      durationMs = Date.now() - startedAt;
      executed = false;

      faults.push({
        callNumber,
        toolName,
        faultType: decision.faultType,
        schedule: decision.schedule,
        seed: decision.seed,
      });

      emit(onEvent, {
        type: 'fault_injected',
        actor: 'injector',
        message: `Injected ${decision.faultType} (instead) on ${toolName} (call #${callNumber})`,
        data: {
          toolName,
          callNumber,
          faultType: decision.faultType,
          schedule: decision.schedule,
          mode: 'instead',
        },
      });
    } else {
      // ─── No injection, or mode 'after' ───
      try {
        const raw = await client.client.callTool({
          name: toolName,
          arguments: args as Record<string, unknown>,
        });
        durationMs = Date.now() - startedAt;
        executed = true;

        if (decision.inject && decision.mode === 'after') {
          // Real server ran — side-effect happened. Replace response.
          result = decision.result;

          faults.push({
            callNumber,
            toolName,
            faultType: decision.faultType,
            schedule: decision.schedule,
            seed: decision.seed,
          });

          emit(onEvent, {
            type: 'fault_injected',
            actor: 'injector',
            message: `Injected ${decision.faultType} (after) on ${toolName} (call #${callNumber})`,
            data: {
              toolName,
              callNumber,
              faultType: decision.faultType,
              schedule: decision.schedule,
              mode: 'after',
            },
          });
        } else {
          result = { status: 'success', data: raw };
        }
      } catch (err) {
        durationMs = Date.now() - startedAt;
        executed = false;
        const message = err instanceof Error ? err.message : String(err);
        result = { status: 'error', message };
      }
    }

    // 2. Record the tool call.
    const record: ToolCallRecord = {
      index: toolCalls.length,
      toolName,
      args,
      result,
      startedAt,
      durationMs,
      executed,
    };
    toolCalls.push(record);

    // 3. Convert to MCP response shape.
    if (result.status === 'success') {
      return result.data;
    }
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: 'message' in result ? result.message : 'tool call failed',
        },
      ],
    };
  }

  // --- Build server ---------------------------------------------------
  const server = await createProxyServer({
    onEvent: (e) => emit(onEvent, e),
    onCallTool: handleCallTool,
    onListTools: handleListTools,
  });

  const closed = Promise.race([server.closed, client.exited]);

  let closedFlag = false;
  async function close(): Promise<void> {
    if (closedFlag) return;
    closedFlag = true;
    await server.close();
    await client.close();
  }

  return {
    server,
    get toolCalls() {
      return toolCalls;
    },
    get faults() {
      return faults;
    },
    closed,
    close,
  };
}