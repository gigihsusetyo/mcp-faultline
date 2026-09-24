// src/proxy/client.ts

/**
 * MCP client wrapper for the external-agent stdio proxy.
 *
 * Responsibility: spawn and manage the *real* MCP server as a child
 * process, expose a connected `Client` from the SDK, and emit
 * lifecycle + security events.
 *
 * What this module does NOT do:
 *   - fault injection (see fault-runtime.ts)
 *   - message routing to/from the agent (see bridge.ts)
 *   - listening on our own stdin (see server.ts)
 *
 * Security posture (Option B+):
 *   - Every spawn is checked against the resolved allowlist
 *   - Non-allowlisted commands emit `command_warned` but still run
 *   - Spawn failure is surfaced as `proxy_error`, never thrown raw
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type { ProxyConfig, ProxyEvent } from './types.js';
import {
  checkCommandAllowed,
  resolveAllowedCommands,
} from './types.js';

// ---------------------------------------------------------------------------
// Options & handle
// ---------------------------------------------------------------------------

/**
 * Event emitted by the client wrapper. `index` and `timestamp` are
 * filled in by the caller (recorder), so they are omitted here.
 */
export type ProxyClientEvent = Omit<ProxyEvent, 'index' | 'timestamp'>;

export interface ProxyClientOptions {
  /** Proxy config — command, args, cwd, env, allowlist. */
  readonly config: ProxyConfig;

  /**
   * Called synchronously for every event the client produces.
   * Must not throw; if it does, the client will emit `proxy_error`
   * and continue.
   */
  readonly onEvent: (event: ProxyClientEvent) => void;
}

export interface ProxyClientHandle {
  /** SDK Client, already connected to the spawned server. */
  readonly client: Client;

  /**
   * Resolves when the child process exits.
   * Never rejects — spawn errors are surfaced via `onEvent` instead.
   */
  readonly exited: Promise<void>;

  /**
   * Gracefully close the client and terminate the child process.
   * Idempotent — safe to call multiple times.
   */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Emit an event through the caller-supplied callback without letting
 * a bad callback crash the proxy.
 */
function emit(
  onEvent: (event: ProxyClientEvent) => void,
  event: ProxyClientEvent
): void {
  try {
    onEvent(event);
  } catch {
    // Swallow: a broken event sink must not take down the proxy.
    // We intentionally do not re-emit here to avoid recursive failure.
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Spawn the real MCP server and connect an SDK Client to it.
 *
 * Resolves once the client is connected and `server_spawn` has been
 * emitted. Rejects only on programmer error (invalid config); runtime
 * spawn failures are reported via `onEvent` and re-thrown as a
 * descriptive Error.
 */
export async function createProxyClient(
  opts: ProxyClientOptions
): Promise<ProxyClientHandle> {
  const { config, onEvent } = opts;

  // 1. Allowlist check (Option B+).
  const allowlist = resolveAllowedCommands(config);
  const check = checkCommandAllowed(config.command, allowlist);
  if (check.allowed) {
    emit(onEvent, {
      type: 'command_allowed',
      actor: 'proxy',
      message: `Command allowlisted: ${config.command}`,
      data: { command: config.command },
    });
  } else {
    emit(onEvent, {
      type: 'command_warned',
      actor: 'proxy',
      message: `Command not in allowlist (running anyway): ${check.command}`,
      data: { command: check.command, allowlist },
    });
  }

  // 2. Build the stdio transport.
  //
  //    We pass `cwd` and `env` straight through. When `env` is omitted,
  //    the SDK inherits the parent's environment — acceptable for MVP,
  //    documented as a limitation in the README.
  const transport = new StdioClientTransport({
    command: config.command,
    args: [...config.args],
    cwd: config.cwd,
    env: config.env ? { ...config.env } : undefined,
    stderr: 'pipe', // keep server logs out of our stdout
  });

  // 3. Create the SDK client.
  const client = new Client(
    { name: 'faultline-proxy', version: '0.1.0' },
    { capabilities: {} }
  );

  // 4. Connect. Any failure here means the server could not start.
  try {
    await client.connect(transport);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit(onEvent, {
      type: 'proxy_error',
      actor: 'proxy',
      message: `Failed to connect to MCP server: ${message}`,
      data: { command: config.command, args: config.args },
    });
    throw new Error(
      `proxy: failed to spawn/connect MCP server (${config.command}): ${message}`
    );
  }

  // 5. Emit spawn success.
  emit(onEvent, {
    type: 'server_spawn',
    actor: 'proxy',
    message: `MCP server spawned: ${config.command}`,
    data: {
      command: config.command,
      args: [...config.args],
      cwd: config.cwd ?? process.cwd(),
    },
  });

  // 6. Build the exited promise.
  //
  //    The SDK transport exposes `onclose`; we bridge it to a promise
  //    so callers (bridge, runner) can await termination without
  //    polling. We only emit `server_exit` once.
  let exitEmitted = false;
  const exited = new Promise<void>((resolve) => {
    const handleClose = (): void => {
      if (exitEmitted) return;
      exitEmitted = true;
      emit(onEvent, {
        type: 'server_exit',
        actor: 'server',
        message: 'MCP server process exited',
        data: { command: config.command },
      });
      resolve();
    };

    // Transport's onclose is the canonical signal for child exit.
    transport.onclose = handleClose;
  });

  // 7. Close helper — idempotent.
  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    try {
      await client.close();
    } catch {
      // Already closed / transport dead — nothing to do.
    }
  }

  return { client, exited, close };
}