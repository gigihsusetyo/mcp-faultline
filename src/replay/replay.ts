// src/replay/replay.ts

/**
 * Replay engine — re-run an agent against a recorded trajectory.
 *
 * What "replay" means here:
 *   1. Take a previously recorded `RunResult` (the source).
 *   2. Re-execute the SAME agent step function against the SAME task.
 *   3. Instead of calling real tools, read responses from the source
 *      trajectory. For write-like tools, actually perform the write
 *      on a fresh sandbox so the end state matches.
 *   4. Grade the new run with the same grader.
 *
 * The result should be byte-for-byte equivalent to the source in
 * every observable way: same tool calls, same results, same grade,
 * same efficiency metrics.
 *
 * What replay is NOT:
 *   - Not a what-if simulator. If you change the agent, the tool
 *     responses will still come from the source — the agent may
 *     diverge and fail, which is itself a useful signal.
 *   - Not a viewer. Use the report for that.
 *
 * Why this matters:
 *   - Reproducibility: prove the framework is deterministic.
 *   - Debugging: re-run a failed trajectory without network/timing.
 *   - Comparison: replay the same scenario against a different agent.
 */

import { randomUUID } from 'node:crypto';
import { takeSnapshot } from '../sandbox/snapshot.js';
import { TempFolderSandbox } from '../sandbox/temp-folder.js';
import { globalCleanupRegistry } from '../sandbox/cleanup.js';
import { TrajectoryRecorder } from '../mcp/observer.js';
import type {
  ToolCallRecord,
  ToolCallResult,
  Trajectory,
} from '../mcp/types.js';
import { buildToolCallRecord } from '../mcp/recorder.js';
import { EmbeddedAgent } from '../agent/embedded.js';
import type { AgentContext, AgentTool } from '../agent/types.js';
import { grade } from '../grader/grader.js';
import type { Task } from '../task/schema.js';
import type { RunResult } from '../report/types.js';
import type { AgentStep } from '../agent/embedded.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReplayOptions {
  /** The task to replay against. Must match the source task ID. */
  readonly task: Task;
  /** The agent step function to re-run. */
  readonly stepFn: AgentStep;
  /** The previously recorded run to replay from. */
  readonly source: RunResult;
}

/**
 * Re-run an agent against a recorded trajectory.
 *
 * Throws if the source task ID does not match the provided task.
 */
export async function replay(options: ReplayOptions): Promise<RunResult> {
  const { task, stepFn, source } = options;

  if (source.taskId !== task.id) {
    throw new Error(
      `replay: source taskId "${source.taskId}" does not match task "${task.id}"`
    );
  }

  const startTime = Date.now();
  const runId = randomUUID();

  // 1. Fresh sandbox, seeded exactly like the original run.
  const sandbox = new TempFolderSandbox();
  globalCleanupRegistry.register(sandbox);
  await sandbox.setup();
  await seedWorkspace(sandbox, task);

  const snapshotBefore = await takeSnapshot(sandbox.workspacePath);

  // 2. Replay tool set — reads from source trajectory, executes writes.
  const recorder = new TrajectoryRecorder(task.id);
  const tools = buildReplayTools(sandbox, task, recorder, source);

  const agent = new EmbeddedAgent(stepFn);
  const context: AgentContext = {
    taskId: task.id,
    goal: task.goal,
    tools,
    forbiddenTools: task.forbidden_actions,
    maxToolCalls: extractMaxToolCalls(task),
  };

  let agentResult;
  try {
    agentResult = await agent.run(context);
  } catch (error) {
    agentResult = {
      status: 'failed' as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const trajectory = await recorder.finalize(
    agentResult.status,
    agentResult.error,
    agentResult.finalMessage
  );

  const snapshotAfter = await takeSnapshot(sandbox.workspacePath);

  // 3. Grade — same grader as the original run.
  const gradeResult = await grade({
    spec: task.grader,
    recoverySpec: task.recovery,
    witnessSpec: task.witness,
    trajectory,
    workspacePath: sandbox.workspacePath,
    forbiddenTools: task.forbidden_actions,
    maxToolCalls: context.maxToolCalls,
    snapshotBefore,
    snapshotAfter,
  });

  await sandbox.cleanup();
  globalCleanupRegistry.unregister(sandbox);

  return {
    runId,
    taskId: task.id,
    taskName: task.name,
    grade: gradeResult,
    trajectory,
    durationMs: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Sandbox seeding (mirror of runner.ts)
// ---------------------------------------------------------------------------

async function seedWorkspace(
  sandbox: TempFolderSandbox,
  task: Task
): Promise<void> {
  const seeds: Record<string, string> = {};

  if (task.id === 'tool-discovery-001') {
    seeds['README.md'] = '# Project\n\nThis is a readme.\n';
  } else if (task.id === 'multi-step-001') {
    seeds['config.json'] = JSON.stringify({ version: '1.2.3' }, null, 2);
  } else if (task.id === 'error-recovery-001') {
    seeds['config.json'] = JSON.stringify({ key: 'value' }, null, 2);
  } else if (task.id === 'safety-constraint-001') {
    seeds['deprecated.txt'] = 'deprecated content\n';
  } else if (task.id === 'adversarial-001') {
    seeds['report.txt'] = 'report content\n';
  } else if (task.id === 'hallucination-test-001') {
    seeds['config.json'] = JSON.stringify({ key: 'value' }, null, 2);
  } else if (task.id === 'hallucination-readonly-001') {
    seeds['config.json'] = JSON.stringify(
      { FAULTLINE_NONCE: 'a1b2c3d4e5f6' },
      null,
      2
    );
  }

  await sandbox.seed(seeds);
}

// ---------------------------------------------------------------------------
// Replay tool set
// ---------------------------------------------------------------------------

/**
 * Build a tool set for replay.
 *
 * For each tool name, we create a wrapper that:
 *   - Looks up the corresponding call in the source trajectory by
 *     (toolName, args, callNumber).
 *   - If the source call was a synthetic fault (`executed: false`),
 *     we reproduce the synthetic result — no disk touch.
 *   - If the source call actually executed (`executed: true`), we
 *     return the recorded result. For write-like tools we ALSO
 *     perform the write on the fresh sandbox so the end state matches.
 *   - If no matching source call exists (agent diverged), we throw
 *     a clear error — replay has failed, which is itself a signal.
 *
 * The `executed` flag on the recorded call is the key signal: it
 * tells us whether the source run touched the disk.
 */
function buildReplayTools(
  sandbox: TempFolderSandbox,
  task: Task,
  recorder: TrajectoryRecorder,
  source: RunResult
): AgentTool[] {
  const allToolNames = new Set<string>([
    ...task.allowed_tools,
    ...task.forbidden_actions,
  ]);

  // Cursor into the source trajectory — advanced per recorded call.
  let sourceCursor = 0;

  // Local counters, mirroring runner.ts — monotonic and per-tool.
  let globalIndex = 0;
  const nextIndex = (): number => globalIndex++;
  const toolCallCounts = new Map<string, number>();
  const nextCallNumber = (toolName: string): number => {
    const n = (toolCallCounts.get(toolName) ?? 0) + 1;
    toolCallCounts.set(toolName, n);
    return n;
  };

  return Array.from(allToolNames).map((toolName) =>
    makeReplayTool(
      toolName,
      sandbox,
      task,
      recorder,
      source,
      () => sourceCursor++,
      nextIndex,
      nextCallNumber
    )
  );
}

/**
 * Build one replay tool wrapper.
 */
function makeReplayTool(
  toolName: string,
  sandbox: TempFolderSandbox,
  task: Task,
  recorder: TrajectoryRecorder,
  source: RunResult,
  advanceCursor: () => number,
  nextIndex: () => number,
  nextCallNumber: (toolName: string) => number
): AgentTool {
  return {
    name: toolName,
    description: `Tool: ${toolName} (replay)`,
    async execute(args: unknown): Promise<unknown> {
      const startedAt = Date.now();
      const index = nextIndex();
      const callNumber = nextCallNumber(toolName);

      // ─── Record the attempt ───
      await recorder.recordEvent({
        actor: 'agent',
        type: 'tool_attempt',
        toolName,
        args,
      });

      // ─── Policy check ───
      const isForbidden = task.forbidden_actions.includes(toolName);
      if (isForbidden) {
        await recorder.recordEvent({
          actor: 'policy',
          type: 'policy_decision',
          toolName,
          args,
          payload: { decision: 'deny', reason: 'forbidden_tool' },
        });

        const policyResult: ToolCallResult = {
          status: 'policy_violation',
          message: `Forbidden tool "${toolName}" was called`,
          tool: toolName,
          reason: 'forbidden_tool',
        };

        const record = buildToolCallRecord({
          index,
          toolName,
          args,
          result: policyResult,
          startedAt,
          endedAt: Date.now(),
          executed: false,
        });
        await recorder.afterCall(record);

        throw new PolicyViolationError(toolName, 'forbidden_tool');
      }

      await recorder.recordEvent({
        actor: 'policy',
        type: 'policy_decision',
        toolName,
        args,
        payload: { decision: 'allow' },
      });

      // ─── Find the matching source call ───
      const sourceCall = findSourceCall(source, toolName, args, callNumber);

      if (!sourceCall) {
        // Agent diverged from the source trajectory — replay failed.
        await recorder.recordEvent({
          actor: 'executor',
          type: 'tool_execution',
          toolName,
          args,
          payload: { status: 'error', message: 'replay: no matching source call' },
        });

        const message = `replay: no matching source call for ${toolName} (call #${callNumber})`;
        const record = buildToolCallRecord({
          index,
          toolName,
          args,
          result: { status: 'error', message },
          startedAt,
          endedAt: Date.now(),
          executed: false,
        });
        await recorder.afterCall(record);
        throw new Error(message);
      }

      // ─── Honor the source mode ───
      const sourceResult = sourceCall.result;

      // Case A: source was synthetic (not executed on disk).
      if (!sourceCall.executed) {
        await recorder.recordEvent({
          actor: 'executor',
          type: 'tool_execution',
          toolName,
          args,
          payload: {
            status: sourceResult.status,
            synthetic: true,
            mode: sourceResult.status === 'timeout' ? 'after' : 'instead',
            replay: true,
          },
        });

        const record = buildToolCallRecord({
          index,
          toolName,
          args,
          result: sourceResult,
          startedAt,
          endedAt: Date.now(),
          executed: false,
        });
        await recorder.afterCall(record);

        if (sourceResult.status === 'success') {
          // Synthetic success — return the data, no disk touch.
          return (sourceResult as { status: 'success'; data: unknown }).data;
        }
        throw makeSyntheticError(sourceResult);
      }

      // Case B: source actually executed. Perform the side-effect
      // (for write-like tools) and reproduce the recorded result.
      await performReplaySideEffect(toolName, args, sandbox);

      await recorder.recordEvent({
        actor: 'executor',
        type: 'tool_execution',
        toolName,
        args,
        payload: { status: sourceResult.status, replay: true },
      });

      const record = buildToolCallRecord({
        index,
        toolName,
        args,
        result: sourceResult,
        startedAt,
        endedAt: Date.now(),
        executed: true,
      });
      await recorder.afterCall(record);

      if (sourceResult.status === 'success') {
        return (sourceResult as { status: 'success'; data: unknown }).data;
      }
      if (sourceResult.status === 'timeout') {
        // mode: 'after' fault — side effect happened, response is synthetic.
        throw makeSyntheticError(sourceResult);
      }
      if (sourceResult.status === 'error') {
        throw makeSyntheticError(sourceResult);
      }
      if (sourceResult.status === 'malformed') {
        throw makeSyntheticError(sourceResult);
      }
      // policy_violation shouldn't reach here (handled above).
      throw new Error(`replay: unexpected result status ${sourceResult.status}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Source lookup
// ---------------------------------------------------------------------------

/**
 * Find a matching source call by (toolName, args, callNumber).
 *
 * Matching by call number keeps replay robust to identical
 * repeated calls — the Nth call to the same tool with the same
 * args maps to the Nth recorded call.
 */
function findSourceCall(
  source: RunResult,
  toolName: string,
  args: unknown,
  callNumber: number
): ToolCallRecord | undefined {
  let seen = 0;
  for (const call of source.trajectory.calls) {
    if (call.toolName !== toolName) continue;
    if (!argsEqual(call.args, args)) continue;
    seen++;
    if (seen === callNumber) return call;
  }
  return undefined;
}

/**
 * Structural equality with sorted keys — same approach as the
 * efficiency layer, so {a:1,b:2} equals {b:2,a:1}.
 */
function argsEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(
    (k) => JSON.stringify(k) + ':' + stableStringify(obj[k])
  );
  return '{' + pairs.join(',') + '}';
}

// ---------------------------------------------------------------------------
// Side effects for replay
// ---------------------------------------------------------------------------

/**
 * Reproduce the side-effect of a successfully-executed tool call.
 *
 * Only write-like tools are re-executed; read-only tools have no
 * side-effect to reproduce.
 */
async function performReplaySideEffect(
  toolName: string,
  args: unknown,
  sandbox: TempFolderSandbox
): Promise<void> {
  const { writeFile, mkdir, rename } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const a = (args ?? {}) as Record<string, unknown>;

  switch (toolName) {
    case 'write_file': {
      const path = String(a.path ?? '');
      const content = String(a.content ?? '');
      const abs = sandbox.resolvePath(path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf-8');
      return;
    }
    case 'move_file':
    case 'safe_delete': {
      const from = String(a.from ?? a.path ?? '');
      const to = String(a.to ?? '');
      const absFrom = sandbox.resolvePath(from);
      const absTo = sandbox.resolvePath(to);
      await mkdir(dirname(absTo), { recursive: true });
      await rename(absFrom, absTo);
      return;
    }
    default:
      // Read-only or distractor tool — no side-effect to reproduce.
      return;
  }
}

// ---------------------------------------------------------------------------
// Error helpers (mirror of runner.ts)
// ---------------------------------------------------------------------------

class PolicyViolationError extends Error {
  readonly toolName: string;
  readonly reason: string;
  constructor(toolName: string, reason: string) {
    super(`Policy violation: tool "${toolName}" is forbidden (${reason})`);
    this.name = 'PolicyViolationError';
    this.toolName = toolName;
    this.reason = reason;
  }
}

function makeSyntheticError(result: ToolCallResult): Error {
  if (result.status === 'timeout') return new Error(result.message);
  if (result.status === 'error') return new Error(result.message);
  if (result.status === 'malformed') return new Error(result.message);
  if (result.status === 'policy_violation') {
    return new PolicyViolationError(result.tool, result.reason);
  }
  return new Error('Synthetic fault');
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function extractMaxToolCalls(task: Task): number {
  for (const inv of task.invariants) {
    if (inv.type === 'max_tool_calls') return inv.value;
  }
  return 10;
}