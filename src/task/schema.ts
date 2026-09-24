// src/task/schema.ts

import { z } from 'zod';
import { FAULT_TYPES } from '../fault/registry.js';

/**
 * Task specification schema for MCP-Faultline.
 *
 * A task defines:
 * - What the agent should accomplish (goal)
 * - What tools are allowed (allowed_tools)
 * - What actions are forbidden (forbidden_actions)
 * - What invariants must hold (invariants)
 * - What faults to inject (fault_injection)
 * - What recovery behavior is expected (recovery)
 * - How to grade the result (grader)
 */

// ============================================================
// FAULT INJECTION
// ============================================================

/**
 * Fault types are sourced from the fault registry so every layer
 * (schema, strategies, proxy runtime) stays in sync.
 *
 * The cast widens the readonly tuple to a mutable tuple at the
 * type level, which z.enum requires. The runtime values are the
 * literal fault type strings.
 */
export const FaultTypeSchema = z.enum(
  FAULT_TYPES as unknown as [string, ...string[]]
);

/**
 * Injection mode — WHEN the fault is applied relative to execution.
 *
 *   - `instead` : the fault replaces execution. The real tool is
 *                 NOT called. No side-effects occur.
 *   - `after`   : the fault is appended to the response AFTER the
 *                 real tool runs. Side-effects DO occur.
 *
 * `after` is what makes idempotency violations possible: the write
 * succeeds, but the agent sees a timeout and retries.
 *
 * Default is `instead` for backward compatibility — all existing
 * task YAMLs continue to behave as before.
 */
export const InjectionModeSchema = z.enum(['instead', 'after']);

export const FaultInjectionSchema = z.object({
  tool: z.string().min(1, 'Tool name is required'),
  call_number: z.number().int().positive().default(1),
  fault: FaultTypeSchema,

  /**
   * When to apply the fault. Defaults to `instead` so existing tasks
   * keep their original behavior.
   */
  mode: InjectionModeSchema.default('instead'),

  /** Optional human-readable message, surfaced in the synthetic result. */
  message: z.string().optional(),

  /**
   * Optional delay in milliseconds. Used by latency-style faults
   * (latency, delayed) to record how long the synthetic call "took".
   */
  duration_ms: z.number().int().positive().optional(),

  /**
   * Optional target field for data-shape faults that need to know
   * which field to corrupt (e.g. wrong_value, missing_field).
   */
  target_field: z.string().optional(),

  /**
   * Optional replacement value for wrong_value faults.
   */
  target_value: z.unknown().optional(),
});

// ============================================================
// INVARIANTS
// ============================================================

/**
 * Invariants are behavioral constraints that must hold during the run.
 */
export const InvariantSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('path_within'),
    value: z.string().default('./workspace'),
  }),
  z.object({
    type: z.literal('no_file_deleted'),
  }),
  z.object({
    type: z.literal('max_tool_calls'),
    value: z.number().int().positive(),
  }),
]);

// ============================================================
// WITNESS — causal evidence that the agent actually worked
// ============================================================

/**
 * A witness is a piece of evidence that can only be produced by
 * the agent actually doing the task. It is used to distinguish
 * real success from hallucinated success.
 *
 * Types:
 * - state_delta: a file must have changed during the run
 * - content_match: a value from a source must appear in a target
 */
export const WitnessSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state_delta'),
    target: z.string().min(1),
    must_change: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('content_match'),
    source: z.string().min(1),
    target: z.string().min(1),
  }),
]);

// ============================================================
// RECOVERY — 2 DIMENSI
// ============================================================

/**
 * Recovery Strategy — WHAT the agent does after a fault.
 *
 * `not-applicable` is used when no fault occurred — there is
 * nothing to recover from. It is not a strategy the agent
 * chose; it is the absence of a recovery situation.
 */
export const RecoveryStrategySchema = z.enum([
  'retry',
  'fallback',
  'abort',
  'degrade',
  'replan',
  'ask-human',
  'continue',
  'ignore',
  'not-applicable',
]);

/**
 * Recovery Outcome — WHETHER the recovery succeeded.
 *
 * `aborted-safely` is used when the agent intentionally stops
 * in order to respect a policy or safety constraint. This is
 * a correct behavior, not a failure.
 */
export const RecoveryOutcomeSchema = z.enum([
  'recovered',
  'partially-recovered',
  'unsafe-attempted',
  'unsafe-recovery',
  'failed',
  'looped',
  'false-recovery',
  'aborted-safely',
]);

/**
 * Recovery specification — declares what recovery behavior is expected.
 */
export const RecoverySpecSchema = z.object({
  primary: z.string().min(1),
  acceptable: z.array(z.string()).default([]),
  max_attempts: z.number().int().positive().default(3),
  expected_outcome: RecoveryOutcomeSchema.default('recovered'),
  allowed_strategies: z.array(RecoveryStrategySchema).default([
    'retry',
    'fallback',
    'abort',
  ]),
});

// ============================================================
// GRADER
// ============================================================

export const StateAssertionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('file_exists'),
    target: z.string().min(1),
  }),
  z.object({
    type: z.literal('file_changed'),
    target: z.string().min(1),
  }),
  z.object({
    type: z.literal('file_valid_json'),
    target: z.string().min(1),
  }),
  z.object({
    type: z.literal('file_contains'),
    target: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    type: z.literal('command_succeeded'),
    target: z.string().min(1),
  }),
]);

export const PolicyAssertionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('no_forbidden_tool_called'),
  }),
  z.object({
    type: z.literal('no_file_deleted'),
  }),
  z.object({
    type: z.literal('path_within_workspace'),
  }),
  z.object({
    type: z.literal('max_tool_calls'),
    value: z.number().int().positive(),
  }),
]);

/**
 * Integrity assertions — verify side-effects on the workspace.
 *
 * Unlike state assertions (which check the END state), integrity
 * assertions check WHAT CHANGED and HOW MANY TIMES. They are the
 * foundation for detecting idempotency violations: an agent that
 * writes the same file twice when once would suffice.
 *
 * Three types:
 * - file_unchanged:              file must NOT change during the run
 * - file_written_at_most_once:   file may change, but at most once
 * - file_written_exactly_once:   file must change, exactly once
 */
export const IntegrityAssertionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('file_unchanged'),
    target: z.string().min(1),
  }),
  z.object({
    type: z.literal('file_written_at_most_once'),
    target: z.string().min(1),
  }),
  z.object({
    type: z.literal('file_written_exactly_once'),
    target: z.string().min(1),
  }),
]);

export const GraderSchema = z.object({
  state_assertions: z.array(StateAssertionSchema).default([]),
  policy_assertions: z.array(PolicyAssertionSchema).default([]),
  integrity_assertions: z.array(IntegrityAssertionSchema).default([]),
});

// ============================================================
// TASK
// ============================================================

export const TaskSchema = z.object({
  id: z.string().min(1, 'Task ID is required'),
  name: z.string().min(1, 'Task name is required'),
  description: z.string().optional(),
  goal: z.string().min(1, 'Task goal is required'),

  allowed_tools: z
    .array(z.string())
    .min(1, 'At least one allowed tool is required'),
  forbidden_actions: z.array(z.string()).default([]),

  invariants: z.array(InvariantSchema).default([]),

  fault_injection: z.array(FaultInjectionSchema).default([]),

  recovery: RecoverySpecSchema,

  witness: WitnessSchema.optional(),

  grader: GraderSchema,
});

// ============================================================
// TYPES
// ============================================================

/**
 * FaultType is defined in the registry and re-exported here for
 * convenience. Consumers should prefer this over
 * `z.infer<typeof FaultTypeSchema>` (which widens to `string`).
 */
export type { FaultType } from '../fault/registry.js';

export type InjectionMode = z.infer<typeof InjectionModeSchema>;
export type FaultInjection = z.infer<typeof FaultInjectionSchema>;
export type Invariant = z.infer<typeof InvariantSchema>;
export type RecoveryStrategy = z.infer<typeof RecoveryStrategySchema>;
export type RecoveryOutcome = z.infer<typeof RecoveryOutcomeSchema>;
export type RecoverySpec = z.infer<typeof RecoverySpecSchema>;
export type StateAssertion = z.infer<typeof StateAssertionSchema>;
export type PolicyAssertion = z.infer<typeof PolicyAssertionSchema>;
export type IntegrityAssertion = z.infer<typeof IntegrityAssertionSchema>;
export type Grader = z.infer<typeof GraderSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Witness = z.infer<typeof WitnessSchema>;