// src/grader/index.ts

/**
 * Grader module — evaluates agent behavior against task assertions.
 *
 * Five layers of verification:
 *   1. State assertions      — end state of the workspace
 *   2. Policy assertions     — behavioral constraints during the run
 *   3. Recovery classification — how the agent responded to faults
 *   4. Integrity assertions  — side-effects on the workspace
 *   5. Efficiency metrics    — informational, not pass/fail
 *
 * Public API:
 * - grade                 — main entry point
 * - classifyRecovery      — recovery classifier
 * - evaluateIntegrityAssertion — integrity evaluator
 * - computeEfficiency     — efficiency metrics
 * - Types: GradeResult, AssertionResult, RecoveryResult, EfficiencyMetrics
 */

export * from './types.js';
export * from './state.js';
export * from './policy.js';
export * from './integrity.js';
export * from './recovery.js';
export * from './witness.js';
export * from './efficiency.js';
export * from './grader.js';