// src/report/types.ts

import type { GradeResult } from '../grader/types.js';
import type { Trajectory } from '../mcp/types.js';

/**
 * Report types — structured output of a run or a batch of runs.
 */

/**
 * Result of a single run (one task, one execution).
 */
export interface RunResult {
  runId: string;
  taskId: string;
  taskName: string;
  /** Grade from the grader */
  grade: GradeResult;
  /** Full trajectory of tool calls */
  trajectory: Trajectory;
  /** Duration of the entire run in milliseconds */
  durationMs: number;
}

/**
 * Statistics for a batch of runs.
 *
 * Note on the unit of analysis:
 *   - Run-level metrics (`total`, `passed`, `passRate`, ...) treat
 *     every execution as an observation.
 *   - Task-level metrics (`taskLevel`) treat every unique task as an
 *     observation, which is the honest unit when the agent is
 *     deterministic and runs are repeated.
 *
 * Both views are reported side by side so the reader can see where
 * precision may be overstated.
 */
export interface BatchStats {
  // ─── Run-level (every execution is an observation) ───

  /** Total number of runs */
  total: number;
  /** Number of passed runs */
  passed: number;
  /** Number of failed runs */
  failed: number;
  /** Pass rate as a fraction (0.0 - 1.0) */
  passRate: number;
  /** Standard deviation of pass/fail outcomes */
  stdDev: number;
  /** 95% Wilson score confidence interval [low, high] */
  confidenceInterval: [number, number];
  /** Pass rate grouped by task ID */
  byTask: Record<string, { passed: number; total: number; rate: number }>;
  /** Failure distribution by classification */
  failureDistribution: Record<string, number>;

  // ─── Task-level (every unique task is an observation) ───

  /**
   * Macro-level statistics.
   *
   * A task counts as "passed" only when ALL of its runs passed.
   * The macro pass rate is the mean of per-task pass rates —
   * each task contributes equally, regardless of how many times
   * it was executed.
   */
  taskLevel: {
    /** Number of unique task IDs observed. */
    scenarios: number;
    /** Tasks where all runs passed. */
    passed: number;
    /** Tasks where at least one run failed. */
    failed: number;
    /** Mean of per-task pass rates. */
    macroPassRate: number;
  };

  // ─── Sample characteristics ───

  /**
   * Sample quality — the honesty layer.
   *
   * Reports how the sample was constructed so the reader can
   * judge how much weight to give the statistical numbers above.
   */
  dataQuality: {
    runsPerTask: number;
    taskScenarios: number;
    executions: number;
    /**
     * Human-readable warnings about the sample.
     * Empty when no concerns apply.
     */
    warnings: string[];
  };
}

/**
 * Full report for a batch of runs.
 */
export interface BatchReport {
  /** Report metadata */
  meta: {
    generatedAt: number;
    durationMs: number;
    taskCount: number;
    runsPerTask: number;
  };
  /** Statistics */
  stats: BatchStats;
  /** Individual run results */
  runs: RunResult[];
}