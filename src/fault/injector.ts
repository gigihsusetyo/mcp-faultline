// src/fault/injector.ts

import type { FaultInjection } from '../task/schema.js';
import type { FaultInjector, InjectionDecision } from './types.js';
import { buildFaultResult, matchesFault } from './strategies.js';

/**
 * Plan-based fault injector — injects faults according to a
 * predefined plan from the task specification.
 *
 * The plan is a list of FaultInjection entries. For each tool call,
 * the injector checks if any entry matches (tool name + call number).
 * If so, it returns a decision telling the caller HOW to inject:
 *
 *   - `mode: 'instead'` → the real tool must NOT be called
 *   - `mode: 'after'`   → the real tool MUST be called first, then
 *                          its response is replaced by the synthetic
 *                          one
 *
 * The caller (runner or proxy bridge) is responsible for honoring
 * the mode. This injector is a pure decision function.
 *
 * Faults are injected at most once per matching entry. A counter
 * tracks how many times each tool has been called.
 */
export class PlanFaultInjector implements FaultInjector {
  private readonly plan: FaultInjection[];
  private readonly callCounters = new Map<string, number>();

  constructor(plan: FaultInjection[]) {
    this.plan = plan;
  }

  shouldInject(
    toolName: string,
    _args: unknown,
    callNumber: number
  ): InjectionDecision {
    // Update counter for this tool
    const current = this.callCounters.get(toolName) ?? 0;
    const next = current + 1;
    this.callCounters.set(toolName, next);

    // Find a matching fault in the plan
    for (const fault of this.plan) {
      if (matchesFault(fault, toolName, callNumber)) {
        const result = buildFaultResult(fault);
        return { mode: fault.mode, result };
      }
    }

    return { mode: 'none' };
  }

  /**
   * Reset counters — useful when reusing the injector across runs.
   */
  reset(): void {
    this.callCounters.clear();
  }

  /**
   * Number of faults configured in this plan.
   */
  get planSize(): number {
    return this.plan.length;
  }
}

/**
 * No-op injector — never injects faults.
 * Useful for baseline runs where faults are not desired.
 */
export class NoopFaultInjector implements FaultInjector {
  shouldInject(): InjectionDecision {
    return { mode: 'none' };
  }
}