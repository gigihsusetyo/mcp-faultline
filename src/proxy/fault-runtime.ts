// src/proxy/fault-runtime.ts

/**
 * Runtime fault decision engine for the external-agent stdio proxy.
 *
 * Responsibility: given a tool call (name, args, 1-based call number),
 * decide whether to inject a fault — and if so, produce the synthetic
 * ToolCallResult the proxy should return AND tell the bridge HOW to
 * apply it (instead of execution, or after execution).
 *
 * Design:
 *   - Reads the same `FaultInjection[]` shape used by the embedded
 *     injector (see task/schema.ts), so task YAMLs are portable
 *     between embedded and external modes.
 *   - Stateless per decision. The bridge owns call-counting; we just
 *     match against `call_number`.
 *   - Pure decision function — the bridge is responsible for honoring
 *     the returned `mode`.
 *   - Synthetic result construction is delegated to the fault registry.
 *
 * Schedule semantics (kept identical to embedded):
 *   - transient     : inject on exactly the listed `call_number`
 *   - persistent    : inject on every call from `call_number` onward
 *   - probabilistic : inject with probability p on each call
 *
 * Only `transient` is currently expressible via FaultInjectionSchema
 * (single `call_number`). The other two are reserved for a future
 * schema extension; they are wired here so the bridge does not need
 * to change when the schema grows.
 */

import type { FaultInjection, InjectionMode } from '../task/schema.js';
import type { ToolCallResult } from '../mcp/types.js';
import { buildFaultResult } from '../fault/strategies.js';
import type { FaultType } from '../fault/registry.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FaultSchedule = 'transient' | 'persistent' | 'probabilistic';

export interface FaultDecisionInput {
  readonly toolName: string;
  readonly args: unknown;
  /** 1-based call number for this tool name. */
  readonly callNumber: number;
}

/**
 * Decision returned by the runtime.
 *
 * `mode` tells the bridge how to apply the fault:
 *   - `instead` : short-circuit, do NOT call the real server
 *   - `after`   : call the real server FIRST, then replace the
 *                 response with the synthetic one
 *
 * Note: this is the proxy-side decision and carries extra metadata
 * (faultType, schedule, seed) that the bridge records. It is
 * intentionally distinct from `InjectionDecision` in fault/types.ts
 * which is the embeddable, side-effect-free shape.
 */
export type FaultRuntimeDecision =
  | { inject: false }
  | {
      inject: true;
      mode: InjectionMode;
      result: ToolCallResult;
      faultType: FaultType;
      schedule: FaultSchedule;
      seed?: number;
    };

export interface FaultRuntimeHandle {
  decide(input: FaultDecisionInput): FaultRuntimeDecision;
}

export interface FaultRuntimeOptions {
  readonly faultPlan: readonly FaultInjection[];
  /** Optional seed for probabilistic schedules. */
  readonly seed?: number;
}

// ---------------------------------------------------------------------------
// Schedule detection
// ---------------------------------------------------------------------------

/**
 * Determine the schedule for a given spec.
 *
 * Today, FaultInjectionSchema only exposes a single `call_number`,
 * which maps to `transient`. When the schema gains explicit schedule
 * fields, extend this function — nothing else needs to change.
 */
function scheduleOf(_spec: FaultInjection): FaultSchedule {
  return 'transient';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFaultRuntime(
  opts: FaultRuntimeOptions
): FaultRuntimeHandle {
  const plan = opts.faultPlan;
  const seed = opts.seed;

  return {
    decide(input: FaultDecisionInput): FaultRuntimeDecision {
      for (const spec of plan) {
        if (spec.tool !== input.toolName) continue;

        const schedule = scheduleOf(spec);
        const matches = matchSchedule(schedule, spec, input.callNumber, seed);
        if (!matches) continue;

        return {
          inject: true,
          mode: spec.mode,
          result: buildFaultResult(spec),
          faultType: spec.fault as FaultType,
          schedule,
          seed,
        };
      }
      return { inject: false };
    },
  };
}

// ---------------------------------------------------------------------------
// Schedule matching
// ---------------------------------------------------------------------------

function matchSchedule(
  schedule: FaultSchedule,
  spec: FaultInjection,
  callNumber: number,
  seed: number | undefined
): boolean {
  switch (schedule) {
    case 'transient':
      return callNumber === spec.call_number;

    case 'persistent':
      return callNumber >= spec.call_number;

    case 'probabilistic': {
      // Reserved — not reachable today because scheduleOf() always
      // returns 'transient'. Wired now so the bridge stays stable.
      const p = 0.5;
      return deterministicRandom(seed ?? 0, callNumber) < p;
    }
  }
}

/**
 * Deterministic PRNG — mulberry32-style. Ensures probabilistic
 * schedules are reproducible across runs given the same seed.
 */
function deterministicRandom(seed: number, n: number): number {
  let t = (seed + n * 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}