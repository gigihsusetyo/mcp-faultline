// src/cli/proxy-command.ts

/**
 * `faultline proxy` — long-running stdio proxy for external MCP agents.
 *
 * Mode 1 only: the proxy listens on its own stdin/stdout as an MCP
 * server and forwards traffic to a spawned real MCP server. Designed
 * to be registered in an external agent (e.g. Cline) as a command.
 *
 * All diagnostics go to stderr. stdout is reserved for JSON-RPC.
 */

import { createProxyClient } from '../proxy/client.js';
import { createBridge } from '../proxy/bridge.js';
import { createFaultRuntime } from '../proxy/fault-runtime.js';
import {
  createProxyConfig,
  type ProxyConfig,
  type ProxyEvent,
} from '../proxy/types.js';
import type { FaultInjection } from '../task/schema.js';
import { loadTask } from '../task/loader.js';

// ---------------------------------------------------------------------------
// CLI arg shape
// ---------------------------------------------------------------------------

export interface ProxyCommandArgs {
  /** Full server command line, e.g. "node /path/to/server.js --port 3000". */
  readonly server: string;
  /** Optional task YAML — only its `fault_injection` array is used. */
  readonly task?: string;
  /** Optional working directory for the spawned server. */
  readonly cwd?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split a server command line into command + args.
 *
 * Handles single quotes, double quotes, and backslash escapes at a
 * level sufficient for typical MCP server invocations. Not a full
 * shell parser — no variable expansion, no pipes, no redirection.
 */
function splitCommandLine(input: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === ' ' || ch === '\t') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) tokens.push(current);

  if (tokens.length === 0) {
    throw new Error('proxy: --server is empty');
  }

  const [command, ...args] = tokens;
  return { command, args };
}

/**
 * Load `fault_injection` from an optional task YAML file.
 * Returns [] when no task is provided.
 */
async function loadFaultPlan(
  taskPath: string | undefined
): Promise<readonly FaultInjection[]> {
  if (!taskPath) return [];
  const task = await loadTask(taskPath);
  return task.fault_injection ?? [];
}

/**
 * Line-based stderr logger with a `[proxy]` prefix.
 * Never writes to stdout.
 */
function makeLogger(): (
  event: ProxyEvent | Omit<ProxyEvent, 'index' | 'timestamp'>
) => void {
  return (event) => {
    const parts: string[] = ['[proxy]', event.type];
    if (event.message) parts.push('-', event.message);
    process.stderr.write(parts.join(' ') + '\n');
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runProxyCommand(args: ProxyCommandArgs): Promise<number> {
  const log = makeLogger();

  // 1. Parse server command.
  const { command, args: serverArgs } = splitCommandLine(args.server);

  // 2. Load fault plan (optional).
  let faultPlan: readonly FaultInjection[];
  try {
    faultPlan = await loadFaultPlan(args.task);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[proxy] failed to load task: ${message}\n`);
    return 1;
  }

  // 3. Build config.
  const config: ProxyConfig = createProxyConfig({
    command,
    args: serverArgs,
    cwd: args.cwd,
    faultPlan,
  });

  // 4. Spawn real MCP server.
  let client;
  try {
    client = await createProxyClient({ config, onEvent: log });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[proxy] spawn failed: ${message}\n`);
    return 1;
  }

  // 5. Build fault runtime.
  const faultRuntime = createFaultRuntime({ faultPlan });

  // 6. Build bridge (also builds the front-facing server).
  const bridge = await createBridge({
    config,
    client,
    faultRuntime,
    onEvent: log,
  });

  // 7. Graceful shutdown on SIGINT/SIGTERM.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[proxy] received ${signal}, shutting down\n`);
    try {
      await bridge.close();
    } catch {
      // best effort
    }
  };

  const onSigint = (): void => {
    void shutdown('SIGINT');
  };
  const onSigterm = (): void => {
    void shutdown('SIGTERM');
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  // 8. Wait until either side closes.
  await bridge.closed;

  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);

  // Best-effort cleanup after natural close.
  try {
    await bridge.close();
  } catch {
    // ignore
  }

  process.stderr.write('[proxy] exited cleanly\n');
  return 0;
}