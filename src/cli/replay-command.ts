// src/cli/replay-command.ts

/**
 * `faultline replay <path>` — re-run an agent against a recorded
 * trajectory.
 *
 * Loads a RunResult from disk (either directly or from a
 * BatchReport), re-executes the agent against the same task, and
 * prints a comparison between the original and the replay.
 *
 * A successful replay should be byte-for-byte equivalent in every
 * observable dimension: same grade, same tool calls, same
 * efficiency metrics.
 */

import { resolve, dirname, basename } from 'node:path';
import { readdir } from 'node:fs/promises';

import { readJson } from '../report/json.js';
import type { RunResult } from '../report/types.js';
import type { BatchReport } from '../report/types.js';
import { loadTask } from '../task/loader.js';
import { replay } from '../replay/replay.js';
import { defaultStep } from './index.js';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

export interface ReplayCommandArgs {
  /** Path to the JSON file containing a RunResult or BatchReport. */
  readonly source: string;
  /**
   * Optional runId — required when the source is a BatchReport with
   * more than one run.
   */
  readonly runId?: string;
  /**
   * Optional task directory — used to resolve the task YAML.
   * Defaults to `tasks`.
   */
  readonly tasksDir?: string;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runReplayCommand(
  args: ReplayCommandArgs
): Promise<number> {
  const { source, runId, tasksDir = 'tasks' } = args;

  // 1. Load source RunResult.
  let sourceRun: RunResult;
  try {
    sourceRun = await loadSourceRun(source, runId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[replay] failed to load source: ${msg}\n`);
    return 1;
  }

  // 2. Locate the task YAML.
  let task;
  try {
    task = await findTaskById(sourceRun.taskId, resolve(tasksDir));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[replay] failed to locate task: ${msg}\n`);
    return 1;
  }

  process.stderr.write(
    `[replay] source runId: ${sourceRun.runId.slice(0, 8)}\n` +
      `[replay] task: ${task.id} — ${task.name}\n`
  );

  // 3. Replay.
  let replayed: RunResult;
  try {
    replayed = await replay({
      task,
      stepFn: defaultStep,
      source: sourceRun,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[replay] failed: ${msg}\n`);
    return 1;
  }

  process.stderr.write(
    `[replay] replayed runId: ${replayed.runId.slice(0, 8)}\n`
  );

  // 4. Compare.
  const comparison = compareRuns(sourceRun, replayed);
  process.stdout.write(formatComparison(sourceRun, replayed, comparison));

  return comparison.matched ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Source loading
// ---------------------------------------------------------------------------

/**
 * Load a RunResult from disk.
 *
 * Accepts either:
 *   - a raw RunResult JSON
 *   - a BatchReport JSON (in which case `runId` selects which run)
 *
 * When the file is a BatchReport with multiple runs and no `runId`
 * is supplied, we pick the first one — this matches the common case
 * of a single-run report.
 */
async function loadSourceRun(
  filePath: string,
  runId: string | undefined
): Promise<RunResult> {
  const resolved = resolve(filePath);
  const data = await readJson<RunResult | BatchReport>(resolved);

  if (isBatchReport(data)) {
    if (data.runs.length === 0) {
      throw new Error('batch report contains no runs');
    }
    if (runId) {
      const match = data.runs.find((r) => r.runId === runId);
      if (!match) {
        throw new Error(`runId "${runId}" not found in batch report`);
      }
      return match;
    }
    return data.runs[0];
  }

  if (isRunResult(data)) {
    return data;
  }

  throw new Error(
    `unrecognized JSON shape at ${basename(resolved)} ` +
      `(expected RunResult or BatchReport)`
  );
}

function isBatchReport(x: unknown): x is BatchReport {
  return (
    typeof x === 'object' &&
    x !== null &&
    'runs' in x &&
    Array.isArray((x as { runs: unknown }).runs) &&
    'meta' in x
  );
}

function isRunResult(x: unknown): x is RunResult {
  return (
    typeof x === 'object' &&
    x !== null &&
    'runId' in x &&
    'taskId' in x &&
    'grade' in x &&
    'trajectory' in x
  );
}

// ---------------------------------------------------------------------------
// Task lookup
// ---------------------------------------------------------------------------

/**
 * Find a task YAML by its `id` field.
 *
 * Scans the given directory (non-recursive) and its immediate
 * subdirectories for a YAML whose `id` matches.
 */
async function findTaskById(taskId: string, tasksDir: string): Promise<import('../task/schema.js').Task> {
  const candidates: string[] = [];

  // Top-level YAMLs
  const top = await readdir(tasksDir, { withFileTypes: true });
  for (const entry of top) {
    if (entry.isFile() && entry.name.endsWith('.yaml')) {
      candidates.push(resolve(tasksDir, entry.name));
    } else if (entry.isDirectory()) {
      // One level of subdirectories (proxy-only/, integrity-only/, ...)
      const sub = await readdir(resolve(tasksDir, entry.name), {
        withFileTypes: true,
      });
      for (const sub2 of sub) {
        if (sub2.isFile() && sub2.name.endsWith('.yaml')) {
          candidates.push(resolve(tasksDir, entry.name, sub2.name));
        }
      }
    }
  }

  for (const path of candidates) {
    try {
      const task = await loadTask(path);
      if (task.id === taskId) return task;
    } catch {
      // Skip files that don't parse — they may be partial YAMLs.
      continue;
    }
  }

  throw new Error(`no task found with id "${taskId}" under ${tasksDir}`);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

interface Comparison {
  readonly matched: boolean;
  readonly gradeMatch: boolean;
  readonly toolCallsMatch: boolean;
  readonly efficiencyMatch: boolean;
  readonly notes: string[];
}

/**
 * Compare source vs replayed RunResult.
 *
 * The comparison is intentionally strict: same grade verdict, same
 * number of tool calls, same efficiency numbers. Any divergence is
 * reported as a note.
 */
function compareRuns(source: RunResult, replayed: RunResult): Comparison {
  const notes: string[] = [];

  const gradeMatch = source.grade.passed === replayed.grade.passed;
  if (!gradeMatch) {
    notes.push(
      `grade mismatch: source=${source.grade.passed}, replay=${replayed.grade.passed}`
    );
  }

  const sourceCalls = source.trajectory.calls.length;
  const replayCalls = replayed.trajectory.calls.length;
  const toolCallsMatch = sourceCalls === replayCalls;
  if (!toolCallsMatch) {
    notes.push(`tool call count mismatch: source=${sourceCalls}, replay=${replayCalls}`);
  }

  const efficiencyMatch = efficiencyEqual(
    source.grade.efficiency,
    replayed.grade.efficiency
  );
  if (!efficiencyMatch) {
    notes.push(
      `efficiency mismatch: source=${JSON.stringify(source.grade.efficiency)}, ` +
        `replay=${JSON.stringify(replayed.grade.efficiency)}`
    );
  }

  const matched = gradeMatch && toolCallsMatch && efficiencyMatch;
  return { matched, gradeMatch, toolCallsMatch, efficiencyMatch, notes };
}

function efficiencyEqual(
  a: RunResult['grade']['efficiency'],
  b: RunResult['grade']['efficiency']
): boolean {
  return (
    a.toolCalls === b.toolCalls &&
    a.retries === b.retries &&
    a.fallbackDepth === b.fallbackDepth &&
    a.duplicateActions === b.duplicateActions
    // durationMs is wall-time — expected to differ, so excluded.
  );
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function formatComparison(
  source: RunResult,
  replayed: RunResult,
  c: Comparison
): string {
  const lines: string[] = [];
  lines.push('=== replay comparison ===');
  lines.push('');
  lines.push(`Source runId:   ${source.runId}`);
  lines.push(`Replayed runId: ${replayed.runId}`);
  lines.push(`Task:           ${source.taskId} — ${source.taskName}`);
  lines.push('');
  lines.push('Match summary:');
  lines.push(`  grade:      ${c.gradeMatch ? '✅' : '❌'}`);
  lines.push(`  tool calls: ${c.toolCallsMatch ? '✅' : '❌'}`);
  lines.push(`  efficiency: ${c.efficiencyMatch ? '✅' : '❌'}`);
  lines.push('');
  lines.push(`Overall: ${c.matched ? '✅ MATCH' : '❌ MISMATCH'}`);

  if (c.notes.length > 0) {
    lines.push('');
    lines.push('Notes:');
    for (const note of c.notes) {
      lines.push(`  - ${note}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}