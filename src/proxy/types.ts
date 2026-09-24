// src/proxy/types.ts

/**
 * Type definitions for the external-agent stdio proxy.
 *
 * The proxy sits between an external MCP client (agent) and a real
 * MCP server. It forwards JSON-RPC traffic, injects faults per a plan,
 * and records every spawn + message as auditable evidence.
 *
 * Security posture (Option B+):
 *   - Command allowlist with a safe default
 *   - Spawn events always recorded to the trajectory
 *   - Non-allowlisted commands emit a warning but are NOT blocked
 *
 * Design note: `ProxyEvent` is intentionally separate from
 * `TrajectoryEvent` in `src/mcp/types.ts`. The two have different
 * actor unions (proxy lifecycle vs agent behavior) and merging them
 * would force a breaking change across existing modules.
 */

import type { FaultInjection } from '../task/schema.js';
import type { ToolCallRecord } from '../mcp/types.js';

// Re-export so proxy code does not need to reach into task/.
export type { FaultInjection };

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

/**
 * Commands permitted to be spawned by the proxy without a warning.
 * Anything outside this list still runs (Option B+ = warn, don't block),
 * but is flagged in the trajectory for later review.
 *
 * Users can extend this list via `ProxyConfig.allowedCommands`.
 */
export const DEFAULT_ALLOWED_COMMANDS: readonly string[] = [
  'node',
  'npx',
  'python',
  'python3',
];

// ---------------------------------------------------------------------------
// Proxy configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for a single proxy run.
 *
 * `command` + `args` describe the *real* MCP server to spawn.
 * The proxy itself listens on its own stdin/stdout for the agent.
 */
export interface ProxyConfig {
  /** Executable to spawn (e.g. "node", "python3"). */
  readonly command: string;

  /** Arguments passed to the executable. */
  readonly args: readonly string[];

  /**
   * Working directory for the spawned server.
   * Typically a sandbox temp folder.
   * Defaults to process.cwd() when omitted.
   */
  readonly cwd?: string;

  /**
   * Environment variables for the spawned server.
   * When omitted, the child inherits the parent's environment.
   */
  readonly env?: Readonly<Record<string, string>>;

  /**
   * Additional commands to treat as safe, appended to
   * DEFAULT_ALLOWED_COMMANDS. Does not remove defaults.
   */
  readonly allowedCommands?: readonly string[];

  /**
   * Fault plan to apply while forwarding traffic.
   * Same shape as the embedded fault plan — no proxy-specific variant.
   */
  readonly faultPlan?: readonly FaultInjection[];
}

// ---------------------------------------------------------------------------
// Proxy lifecycle events
// ---------------------------------------------------------------------------

/**
 * Discriminator for proxy event types.
 *
 * These are *proxy-level* events, distinct from agent-level events
 * recorded in `TrajectoryEvent`. They describe the proxy's own
 * decisions and the child process lifecycle.
 */
export type ProxyEventType =
  | 'proxy_start'        // proxy booted, listening for agent
  | 'proxy_shutdown'     // proxy exiting
  | 'server_spawn'       // real MCP server child process started
  | 'server_exit'        // real MCP server child process ended
  | 'command_allowed'    // spawn command passed allowlist
  | 'command_warned'     // spawn command NOT in allowlist (still ran)
  | 'request_forwarded'  // agent request forwarded to real server
  | 'response_received'  // real server responded, forwarded back to agent
  | 'fault_injected'     // proxy returned a synthetic fault instead
  | 'message_invalid'    // malformed JSON-RPC from either side
  | 'proxy_error';       // internal error

/**
 * Who caused this proxy event.
 *
 * Note: this is a *different* union from `EventActor` in
 * `src/mcp/types.ts`. Do not conflate the two.
 */
export type ProxyActor = 'proxy' | 'agent' | 'server' | 'injector';

/**
 * A single proxy event, append-only.
 *
 * Field naming mirrors `TrajectoryEvent` where possible:
 *   - `index` is a monotonic sequence (replay-safe)
 *   - `timestamp` is milliseconds since epoch
 */
export interface ProxyEvent {
  /** Monotonic sequence number within this proxy run. */
  readonly index: number;

  /** Event type discriminator. */
  readonly type: ProxyEventType;

  /** Who caused this event. Always known at emit time. */
  readonly actor: ProxyActor;

  /** Milliseconds since epoch. */
  readonly timestamp: number;

  /** Human-readable note. Never contains secrets. */
  readonly message?: string;

  /** Structured payload. Shape depends on `type`. */
  readonly data?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Fault injection metadata (proxy-specific)
// ---------------------------------------------------------------------------

/**
 * Describes a single fault injection decision made by the proxy.
 *
 * The proxy records one of these per injected fault so the grader can
 * correlate agent behavior with the exact fault that triggered it.
 *
 * `faultType` and `schedule` mirror the embedded taxonomy so reports
 * from embedded and external modes stay comparable.
 */
export interface ProxyFaultRecord {
  /** Tool call index (1-based) this fault was applied to. */
  readonly callNumber: number;

  /** Tool name the fault targeted. */
  readonly toolName: string;

  /** Fault kind, mirrors `FaultType` from task/schema.ts. */
  readonly faultType: string;

  /** Whether this was a one-shot, persistent, or probabilistic injection. */
  readonly schedule: 'transient' | 'persistent' | 'probabilistic';

  /** Optional seed for probabilistic schedules. */
  readonly seed?: number;
}

// ---------------------------------------------------------------------------
// Proxy run result
// ---------------------------------------------------------------------------

/**
 * Summary of a completed proxy run.
 *
 * Returned to the CLI, serialized into the report, and paired with the
 * raw trajectory JSONL for replay.
 */
export interface ProxyResult {
  /** Overall success: did the proxy run and shut down cleanly? */
  readonly ok: boolean;

  /** Config actually used (echoed for reproducibility). */
  readonly config: ProxyConfig;

  /** All proxy lifecycle events, in order. */
  readonly events: readonly ProxyEvent[];

  /** All tool calls observed by the proxy, in order. */
  readonly toolCalls: readonly ToolCallRecord[];

  /** All faults injected during the run, in order. */
  readonly faults: readonly ProxyFaultRecord[];

  /** Warnings raised (e.g. non-allowlisted command). Never fatal. */
  readonly warnings: readonly string[];

  /** Populated when `ok === false`. */
  readonly error?: string;

  /** Run duration in milliseconds. */
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Build a ProxyConfig with defaults applied.
 * Kept here so CLI and tests share one canonical construction path.
 */
export function createProxyConfig(
  input: Omit<ProxyConfig, 'allowedCommands'> & {
    allowedCommands?: readonly string[];
  }
): ProxyConfig {
  return {
    ...input,
    allowedCommands: input.allowedCommands ?? [],
  };
}

/**
 * Resolve the effective allowlist: defaults + user extensions, deduped.
 */
export function resolveAllowedCommands(
  config: ProxyConfig
): readonly string[] {
  const merged = new Set<string>([
    ...DEFAULT_ALLOWED_COMMANDS,
    ...(config.allowedCommands ?? []),
  ]);
  return Array.from(merged);
}

/**
 * Check whether a spawn command is allowlisted.
 * Returns a tagged result so callers can emit the right event.
 *
 * Matching is by basename so "/usr/bin/node" and "node" behave the same.
 */
export function checkCommandAllowed(
  command: string,
  allowed: readonly string[]
):
  | { allowed: true }
  | { allowed: false; command: string } {
  const basename = command.split(/[\\/]/).pop() ?? command;
  return allowed.includes(basename)
    ? { allowed: true }
    : { allowed: false, command };
}