// src/grader/integrity.ts

/**
 * Integrity assertion evaluator — verifies SIDE-EFFECTS on the workspace.
 *
 * Where state assertions check the END state ("does file X exist?")
 * and policy assertions check the TRAJECTORY ("did the agent call a
 * forbidden tool?"), integrity assertions check the DELTA:
 * what changed, and how many times.
 *
 * This is the foundation for detecting idempotency violations: an
 * agent that writes the same file twice when once would suffice.
 *
 * Three types:
 *   - file_unchanged             : file must NOT change during the run
 *   - file_written_at_most_once  : file may change, but at most once
 *   - file_written_exactly_once  : file must change, exactly once
 *
 * Write counting uses TWO sources:
 *   1. Trajectory — count `write_file` calls with `executed: true`
 *   2. Snapshot delta — did the file's hash change?
 *
 * `executed: true` covers both normal writes AND `mode: 'after'`
 * faults (where the tool ran but the agent saw an error). It excludes
 * `mode: 'instead'` faults and policy denials, because those never
 * touched the file.
 *
 * Trajectory is the primary source (it knows HOW MANY times).
 * Snapshot is the secondary source (it knows WHETHER the file changed).
 * When the two disagree, that indicates a bug in the tool executor,
 * not agent misbehavior — so the assertion fails with a clear message.
 */

import type { IntegrityAssertion } from '../task/schema.js';
import type { Trajectory } from '../mcp/types.js';
import type { AssertionResult } from './types.js';
import type { Snapshot } from '../sandbox/snapshot.js';
import { didFileChange } from '../sandbox/snapshot.js';
import { assertNever } from '../utils/assert-never.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a single integrity assertion against the run's trajectory
 * and before/after snapshots.
 */
export function evaluateIntegrityAssertion(
  assertion: IntegrityAssertion,
  trajectory: Trajectory,
  snapshotBefore: Snapshot,
  snapshotAfter: Snapshot
): AssertionResult {
  switch (assertion.type) {
    case 'file_unchanged':
      return checkFileUnchanged(assertion.target, snapshotBefore, snapshotAfter);

    case 'file_written_at_most_once':
      return checkFileWrittenAtMostOnce(
        assertion.target,
        trajectory,
        snapshotBefore,
        snapshotAfter
      );

    case 'file_written_exactly_once':
      return checkFileWrittenExactlyOnce(
        assertion.target,
        trajectory,
        snapshotBefore,
        snapshotAfter
      );

    default:
      return assertNever(assertion);
  }
}

// ---------------------------------------------------------------------------
// Type 1: file_unchanged
// ---------------------------------------------------------------------------

function checkFileUnchanged(
  target: string,
  snapshotBefore: Snapshot,
  snapshotAfter: Snapshot
): AssertionResult {
  const changed = didFileChange(snapshotBefore, snapshotAfter, target);

  if (changed === null) {
    return {
      type: 'file_unchanged',
      target,
      passed: true,
      message: 'File not present in either snapshot (nothing to compare)',
    };
  }

  return {
    type: 'file_unchanged',
    target,
    passed: !changed,
    message: changed
      ? `File changed but integrity assertion requires it unchanged: ${target}`
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Type 2: file_written_at_most_once
// ---------------------------------------------------------------------------

function checkFileWrittenAtMostOnce(
  target: string,
  trajectory: Trajectory,
  snapshotBefore: Snapshot,
  snapshotAfter: Snapshot
): AssertionResult {
  const writeCount = countSuccessfulWrites(trajectory, target);
  const snapshotChanged = didFileChange(snapshotBefore, snapshotAfter, target);

  // Conflict: no executed writes but file changed on disk.
  if (writeCount === 0 && snapshotChanged === true) {
    return {
      type: 'file_written_at_most_once',
      target,
      passed: false,
      message: `Conflict: trajectory reports 0 writes but snapshot shows the file changed: ${target}`,
    };
  }

  const passed = writeCount <= 1;
  return {
    type: 'file_written_at_most_once',
    target,
    passed,
    message: passed
      ? undefined
      : `File written ${writeCount} times (expected at most 1): ${target}`,
  };
}

// ---------------------------------------------------------------------------
// Type 3: file_written_exactly_once
// ---------------------------------------------------------------------------

function checkFileWrittenExactlyOnce(
  target: string,
  trajectory: Trajectory,
  snapshotBefore: Snapshot,
  snapshotAfter: Snapshot
): AssertionResult {
  const writeCount = countSuccessfulWrites(trajectory, target);
  const snapshotChanged = didFileChange(snapshotBefore, snapshotAfter, target);

  // Conflict: writes reported but file did not change.
  if (writeCount > 0 && snapshotChanged === false) {
    return {
      type: 'file_written_exactly_once',
      target,
      passed: false,
      message: `Conflict: trajectory reports ${writeCount} write(s) but snapshot shows no change: ${target}`,
    };
  }

  // Conflict: no writes reported but file changed.
  if (writeCount === 0 && snapshotChanged === true) {
    return {
      type: 'file_written_exactly_once',
      target,
      passed: false,
      message: `Conflict: trajectory reports 0 writes but snapshot shows the file changed: ${target}`,
    };
  }

  const passed = writeCount === 1;
  return {
    type: 'file_written_exactly_once',
    target,
    passed,
    message: passed
      ? undefined
      : `File written ${writeCount} times (expected exactly 1): ${target}`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count writes that actually produced a side-effect.
 *
 * A write "counts" when:
 *   - it targets the given path via `write_file`
 *   - `executed === true` — the real tool ran
 *
 * This correctly handles `mode: 'after'` faults: the tool ran
 * (side-effect happened) even though the agent saw an error.
 * A naive `status === 'success'` check would miss these.
 *
 * Policy violations and `mode: 'instead'` faults are NOT counted
 * because the tool never ran.
 */
function countSuccessfulWrites(trajectory: Trajectory, target: string): number {
  const normalized = normalizePath(target);
  let count = 0;

  for (const call of trajectory.calls) {
    if (call.toolName !== 'write_file') continue;
    if (!call.executed) continue;

    const args = call.args as { path?: unknown } | undefined;
    const rawPath = args?.path;
    if (typeof rawPath !== 'string') continue;

    if (normalizePath(rawPath) === normalized) {
      count++;
    }
  }

  return count;
}

/**
 * Normalize a file path for comparison:
 *   - strip leading "./"
 *   - collapse leading slashes (so "/x" and "x" match)
 *
 * This is intentionally minimal — it handles the common cases
 * without trying to be a full path resolver.
 */
function normalizePath(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\/+/, '');
}