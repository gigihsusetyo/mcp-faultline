// src/grader/types.ts

import type {
  StateAssertion,
  PolicyAssertion,
  IntegrityAssertion,
  RecoveryStrategy,
  RecoveryOutcome,
  RecoverySpec,
  Grader as GraderSpec,
  Witness,
} from '../task/schema.js';
import type { Trajectory } from '../mcp/types.js';
import type { Snapshot } from '../sandbox/snapshot.js';

export type {
  StateAssertion,
  PolicyAssertion,
  IntegrityAssertion,
  RecoveryStrategy,
  RecoveryOutcome,
  RecoverySpec,
  GraderSpec,
  Witness,
};

/**
 * Result of a single assertion check.
 */
export interface AssertionResult {
  type: string;
  target: string;
  passed: boolean;
  message?: string;
}

/**
 * Result of a witness evaluation.
 */
export interface WitnessResult {
  type: string;
  passed: boolean;
  message: string;
}

/**
 * Recovery classification result — 2 dimensions.
 */
export interface RecoveryResult {
  strategy: RecoveryStrategy;
  outcome: RecoveryOutcome;
  confidence: number;
  reasoning?: string;
}

/**
 * Efficiency metrics — Layer 5.
 *
 * This layer is INFORMATIONAL: it does not contribute to the
 * pass/fail decision. It exists so two agents that both PASS can
 * still be distinguished by their cost profile.
 *
 * Example: Agent A passes a task in 2 tool calls; Agent B passes
 * the same task in 37 calls with 8 retries. Both are `passed: true`,
 * but the efficiency metadata tells very different stories.
 *
 * All metrics are derived from the trajectory — no extra
 * instrumentation is required.
 */
export interface EfficiencyMetrics {
  /** Total tool calls attempted (successful or not). */
  toolCalls: number;
  /** Consecutive repeats of the same tool + args beyond the first. */
  retries: number;
  /** Times the agent switched to a different tool after a failure. */
  fallbackDepth: number;
  /** Calls whose (tool, args) pair was already seen earlier in the run. */
  duplicateActions: number;
  /** Wall time of the trajectory (endedAt - startedAt), in ms. */
  durationMs: number;
}

/**
 * Overall grading result for a single run.
 *
 * Five layers (as of Fase 10.5):
 *   1. Outcome    — state assertions
 *   2. Safety     — policy assertions
 *   3. Recovery   — recovery classification (2 dimensions)
 *   4. Integrity  — integrity assertions (side-effects)
 *   5. Efficiency — metadata (informational, not pass/fail)
 *
 * Only layers 1-4 contribute to `passed`. Layer 5 is reported
 * alongside but does not affect the verdict.
 */
export interface GradeResult {
  passed: boolean;
  stateResults: AssertionResult[];
  policyResults: AssertionResult[];
  integrityResults: AssertionResult[];
  recovery?: RecoveryResult;
  witness?: WitnessResult;
  efficiency: EfficiencyMetrics;
  summary: string;
}

/**
 * Context passed to the grader.
 */
export interface GraderContext {
  spec: GraderSpec;
  recoverySpec: RecoverySpec;
  witnessSpec?: Witness;
  trajectory: Trajectory;
  workspacePath: string;
  forbiddenTools: string[];
  maxToolCalls: number;
  snapshotBefore: Snapshot;
  snapshotAfter: Snapshot;
}