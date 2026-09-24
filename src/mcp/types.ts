// src/mcp/types.ts

/**
 * MCP observer types — trajectory recording and tool call tracking.
 *
 * The trajectory now contains a typed event log rather than just
 * a flat list of tool calls. Events carry attribution (actor) so
 * the grader can distinguish agent behavior from infrastructure
 * intervention.
 */

/**
 * Who caused this event?
 * - agent: the agent decided to do this
 * - policy: the policy gate intervened
 * - executor: the tool executor ran or failed
 */
export type EventActor = 'agent' | 'policy' | 'executor';

/**
 * The policy decision for a tool call.
 */
export type PolicyDecision = 'allow' | 'deny';

/**
 * A typed event in the trajectory.
 */
export interface TrajectoryEvent {
  /** Monotonic index in the trajectory */
  index: number;
  /** Who caused this event */
  actor: EventActor;
  /** Event type */
  type: 'tool_attempt' | 'policy_decision' | 'tool_execution' | 'tool_result';
  /** Tool name (when applicable) */
  toolName?: string;
  /** Arguments passed to the tool */
  args?: unknown;
  /** Event-specific payload */
  payload?: unknown;
  /** Timestamp (ms since epoch) */
  timestamp: number;
}

/**
 * A single tool call record.
 *
 * `executed` tells the grader whether the real tool actually ran.
 * This matters for two reasons:
 *
 *   - `mode: 'instead'` fault injection: the tool is NOT executed,
 *     so no side-effect occurs. `executed: false`.
 *   - `mode: 'after'` fault injection: the tool IS executed, but
 *     the agent sees a synthetic error. `executed: true`.
 *
 * Without this flag, integrity assertions cannot tell the
 * difference between a fault that prevented a write (instead)
 * and a fault that happened after a successful write (after).
 */
export interface ToolCallRecord {
  /** Monotonic index (0-based) of this call in the trajectory */
  index: number;
  /** Tool name as called by the agent */
  toolName: string;
  /** Arguments passed to the tool */
  args: unknown;
  /** Result returned by the tool (or synthetic fault result) */
  result: ToolCallResult;
  /** Timestamp when the call started (ms since epoch) */
  startedAt: number;
  /** Duration in milliseconds */
  durationMs: number;
  /**
   * Whether the real tool was executed.
   * - `true`  → the tool ran (success OR error), side-effects may exist
   * - `false` → the tool was short-circuited (mode: instead, policy deny)
   */
  executed: boolean;
}

/**
 * Result of a tool call.
 *
 * `policy_violation` is a special status: the agent attempted a
 * forbidden tool, and the policy gate denied it before execution.
 */
export type ToolCallResult =
  | { status: 'success'; data: unknown }
  | { status: 'error'; message: string; code?: string }
  | { status: 'timeout'; message: string }
  | { status: 'malformed'; raw: unknown; message: string }
  | {
      status: 'policy_violation';
      message: string;
      tool: string;
      reason: string;
    };

/**
 * A complete trajectory — the sequence of tool calls made by an agent,
 * plus the full event log.
 */
export interface Trajectory {
  /** Unique run identifier */
  runId: string;
  /** Task ID this trajectory belongs to */
  taskId: string;
  /** Timestamp when the run started */
  startedAt: number;
  /** Timestamp when the run ended */
  endedAt: number;
  /** All tool calls, in order */
  calls: ToolCallRecord[];
  /** Full event log (append-only) */
  events: TrajectoryEvent[];
  /** Final status of the run */
  status: 'completed' | 'failed' | 'aborted' | 'timeout';
  /** Optional error if the run failed */
  error?: string;
  /**
   * Optional final message from the agent.
   *
   * Used to distinguish an honest abort ("I cannot complete this task")
   * from a false completion ("Task done!") when the agent stops after
   * a failure.
   */
  agentFinalMessage?: string;
}