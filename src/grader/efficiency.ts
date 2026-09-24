// src/grader/efficiency.ts

/**
 * Efficiency metrics — Layer 5 of the grader.
 *
 * This layer is INFORMATIONAL. It does not contribute to the
 * pass/fail decision. Its purpose is to distinguish two runs that
 * both pass, by reporting how much work the agent did.
 *
 * All metrics are derived from the trajectory. No extra
 * instrumentation is required at runtime — the recorder already
 * captures everything we need.
 *
 * Metrics (5):
 *   1. toolCalls         — total calls attempted
 *   2. retries           — consecutive repeats of the same (tool, args)
 *   3. fallbackDepth     — switches to a different tool after a failure
 *   4. duplicateActions  — calls whose (tool, args) were seen before
 *   5. durationMs        — wall time of the trajectory
 *
 * Note on `retries` vs `duplicateActions`:
 *   - `retries` counts CONSECUTIVE repeats. Only the immediately
 *     preceding call is compared.
 *   - `duplicateActions` counts CUMULATIVE repeats. Any earlier
 *     call with the same (tool, args) counts.
 *
 *   For a sequence [A, A, A], retries = 2, duplicateActions = 2.
 *   For a sequence [A, B, A], retries = 0, duplicateActions = 1.
 */

import type { Trajectory } from '../mcp/types.js';
import type { EfficiencyMetrics } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute efficiency metrics from a trajectory.
 *
 * Pure function. No side-effects. Safe to call multiple times.
 */
export function computeEfficiency(trajectory: Trajectory): EfficiencyMetrics {
  const calls = trajectory.calls;

  return {
    toolCalls: calls.length,
    retries: countRetries(calls),
    fallbackDepth: countFallbacks(calls),
    duplicateActions: countDuplicates(calls),
    durationMs: Math.max(0, trajectory.endedAt - trajectory.startedAt),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Count consecutive repeats of the same (tool, args).
 *
 * Sequence:  [A, A, A, B, B]
 * Retries:   [0, 1, 2, 0, 1]  → total = 3
 *
 * Only consecutive — a different call in between resets the run.
 */
function countRetries(
  calls: Trajectory['calls']
): number {
  let retries = 0;
  for (let i = 1; i < calls.length; i++) {
    if (sameCall(calls[i], calls[i - 1])) {
      retries++;
    }
  }
  return retries;
}

/**
 * Count "fallbacks" — cases where the agent used a different tool
 * after a failure.
 *
 * A fallback is counted at position i when:
 *   - calls[i - 1] ended in a non-success status
 *   - calls[i] uses a different tool than calls[i - 1]
 *
 * This is a heuristic: it captures "agent abandoned one tool and
 * tried another" without trying to reason about intent.
 */
function countFallbacks(
  calls: Trajectory['calls']
): number {
  let fallbacks = 0;
  for (let i = 1; i < calls.length; i++) {
    const prev = calls[i - 1];
    const curr = calls[i];
    if (!isSuccess(prev) && prev.toolName !== curr.toolName) {
      fallbacks++;
    }
  }
  return fallbacks;
}

/**
 * Count calls whose (tool, args) pair was already seen earlier.
 *
 * The first occurrence of a pair does not count. Every subsequent
 * occurrence counts as a duplicate.
 *
 * Sequence:  [A, B, A, A, C]
 * Duplicates: [0, 0, 1, 2, 0]  → total = 3
 */
function countDuplicates(
  calls: Trajectory['calls']
): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const call of calls) {
    const key = callKey(call);
    if (seen.has(key)) {
      duplicates++;
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}

/**
 * Structural equality of two tool calls — same tool, same args.
 */
function sameCall(
  a: Trajectory['calls'][number],
  b: Trajectory['calls'][number]
): boolean {
  return a.toolName === b.toolName && callKey(a) === callKey(b);
}

/**
 * Stable key for a call: tool name + JSON-serialized args.
 *
 * Args are serialized with sorted keys so that `{a: 1, b: 2}` and
 * `{b: 2, a: 1}` produce the same key.
 */
function callKey(call: Trajectory['calls'][number]): string {
  return `${call.toolName}::${stableStringify(call.args)}`;
}

/**
 * Deterministic JSON.stringify with sorted keys.
 *
 * Handles primitives, arrays, and plain objects. Non-plain values
 * (functions, classes) fall back to String() — acceptable for our
 * use case since tool args are always JSON-serializable.
 */
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

/**
 * Whether a call's result is considered "successful".
 *
 * Only `status === 'success'` counts. Faults (`timeout`, `error`,
 * `malformed`) and `policy_violation` are all non-success.
 */
function isSuccess(call: Trajectory['calls'][number]): boolean {
  return call.result.status === 'success';
}