// src/report/stats.ts

import type { RunResult, BatchStats } from './types.js';

/**
 * Statistical analysis of a batch of runs.
 *
 * We compute:
 * - Run-level: pass rate, stddev, 95% Wilson CI
 * - Task-level: macro pass rate (unit = task, not run)
 * - Data quality: sample characteristics and honesty warnings
 * - Per-task breakdown
 * - Failure distribution
 *
 * Why two levels?
 *   A deterministic agent run N times on the same task produces N
 *   identical observations — not N independent samples. Reporting
 *   only the run-level view overstates precision. The task-level
 *   view treats each task as one observation, which is the honest
 *   unit when runs are repeated.
 */

/**
 * Compute stats for a batch of run results.
 */
export function computeStats(runs: RunResult[]): BatchStats {
  const total = runs.length;

  if (total === 0) {
    return emptyStats();
  }

  // ─── Run-level ───
  const passed = runs.filter((r) => r.grade.passed).length;
  const failed = total - passed;
  const passRate = passed / total;

  // Standard deviation of binary outcomes: sqrt(p * (1 - p))
  const stdDev = Math.sqrt(passRate * (1 - passRate));

  // Wilson score interval for 95% confidence
  const confidenceInterval = wilsonScoreInterval(passed, total, 0.95);

  // ─── Per-task breakdown ───
  const byTask: Record<string, { passed: number; total: number; rate: number }> = {};
  for (const run of runs) {
    if (!byTask[run.taskId]) {
      byTask[run.taskId] = { passed: 0, total: 0, rate: 0 };
    }
    byTask[run.taskId].total++;
    if (run.grade.passed) {
      byTask[run.taskId].passed++;
    }
  }
  for (const taskId of Object.keys(byTask)) {
    const t = byTask[taskId];
    t.rate = t.total > 0 ? t.passed / t.total : 0;
  }

  // ─── Failure distribution ───
  const failureDistribution: Record<string, number> = {};
  for (const run of runs) {
    if (!run.grade.passed) {
      const reason = classifyFailure(run);
      failureDistribution[reason] = (failureDistribution[reason] ?? 0) + 1;
    }
  }

  // ─── Task-level (macro) ───
  const taskLevel = computeTaskLevel(byTask);

  // ─── Data quality ───
  const dataQuality = computeDataQuality(total, byTask, taskLevel.scenarios);

  return {
    total,
    passed,
    failed,
    passRate,
    stdDev,
    confidenceInterval,
    byTask,
    failureDistribution,
    taskLevel,
    dataQuality,
  };
}

// ---------------------------------------------------------------------------
// Task-level
// ---------------------------------------------------------------------------

function computeTaskLevel(
  byTask: Record<string, { passed: number; total: number; rate: number }>
): BatchStats['taskLevel'] {
  const taskIds = Object.keys(byTask);
  const scenarios = taskIds.length;

  let tasksPassed = 0;
  let tasksFailed = 0;
  let rateSum = 0;

  for (const taskId of taskIds) {
    const t = byTask[taskId];
    rateSum += t.rate;
    if (t.rate === 1) {
      tasksPassed++;
    } else {
      tasksFailed++;
    }
  }

  const macroPassRate = scenarios > 0 ? rateSum / scenarios : 0;

  return {
    scenarios,
    passed: tasksPassed,
    failed: tasksFailed,
    macroPassRate,
  };
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

function computeDataQuality(
  totalExecutions: number,
  byTask: Record<string, { passed: number; total: number; rate: number }>,
  scenarios: number
): BatchStats['dataQuality'] {
  const runsPerTask =
    scenarios > 0 ? totalExecutions / scenarios : 0;

  const warnings: string[] = [];

  // Warning 1: single run per task
  if (runsPerTask === 1) {
    warnings.push(
      'Only 1 run per task. With a deterministic agent, each task ' +
        'contributes exactly one observation. Statistical inference ' +
        'is limited.'
    );
  }

  // Warning 2: small sample
  if (scenarios < 10) {
    warnings.push(
      `Small sample: only ${scenarios} task scenario(s). Pass rates ` +
        'and confidence intervals are wide and should be interpreted ' +
        'with caution.'
    );
  }

  return {
    runsPerTask,
    taskScenarios: scenarios,
    executions: totalExecutions,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Wilson score interval
// ---------------------------------------------------------------------------

/**
 * Wilson score interval — 95% CI for a proportion.
 *
 * Reference: https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval
 */
export function wilsonScoreInterval(
  successes: number,
  total: number,
  confidence: number
): [number, number] {
  if (total === 0) {
    return [0, 0];
  }

  // z-score for 95% CI ≈ 1.96
  const z = confidence === 0.95 ? 1.96 : 1.96; // extend for other levels if needed
  const p = successes / total;
  const n = total;
  const zSquared = z * z;

  const denominator = 1 + zSquared / n;
  const center = (p + zSquared / (2 * n)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + zSquared / (4 * n * n))) / denominator;

  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * Classify failure reason for distribution counting.
 */
function classifyFailure(run: RunResult): string {
  const summary = run.grade.summary.toLowerCase();

  if (summary.includes('state assertion')) return 'state_assertion_failed';
  if (summary.includes('policy assertion')) return 'policy_assertion_failed';
  if (summary.includes('integrity assertion')) return 'integrity_assertion_failed';
  if (summary.includes('recovery')) return 'recovery_not_allowed';
  if (run.trajectory.status === 'timeout') return 'agent_timeout';
  if (run.trajectory.status === 'aborted') return 'agent_aborted';
  if (run.trajectory.status === 'failed') return 'agent_failed';

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

function emptyStats(): BatchStats {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    passRate: 0,
    stdDev: 0,
    confidenceInterval: [0, 0],
    byTask: {},
    failureDistribution: {},
    taskLevel: {
      scenarios: 0,
      passed: 0,
      failed: 0,
      macroPassRate: 0,
    },
    dataQuality: {
      runsPerTask: 0,
      taskScenarios: 0,
      executions: 0,
      warnings: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a fraction as a percentage string.
 */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Format a confidence interval.
 */
export function formatCI(ci: [number, number]): string {
  return `[${formatPercent(ci[0])}, ${formatPercent(ci[1])}]`;
}