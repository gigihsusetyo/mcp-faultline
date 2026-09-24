// src/fault/types.ts

import type { FaultInjection, FaultType, InjectionMode } from '../task/schema.js';
import type { ToolCallResult } from '../mcp/types.js';

export type { FaultInjection, FaultType, InjectionMode };

/**
 * Fault injector interface — decides whether to inject a fault
 * on a given tool call, and if so, HOW.
 *
 * Two modes:
 *   - `instead` : the fault REPLACES execution. The real tool is
 *                 never called. No side-effects occur.
 *   - `after`   : the fault is APPENDED to the response AFTER the
 *                 real tool runs. Side-effects DO occur.
 *
 * `after` is what makes idempotency violations possible: the write
 * succeeds, but the agent sees a timeout and retries.
 *
 * The injector is consulted BEFORE each tool call. The runner (or
 * proxy bridge) is responsible for honoring the returned mode:
 *   - `instead` → short-circuit, do not call the real tool
 *   - `after`   → call the real tool, then replace its response
 */
export interface FaultInjector {
  /**
   * Decide how to handle this call.
   *
   * @param toolName - Tool being called
   * @param args - Arguments passed to the tool
   * @param callNumber - 1-based call number (per tool name)
   * @returns An InjectionDecision — `none` if no fault applies
   */
  shouldInject(
    toolName: string,
    args: unknown,
    callNumber: number
  ): InjectionDecision;
}

/**
 * Decision returned by a fault injector.
 *
 *   - `none`    : no fault — proceed normally
 *   - `instead` : return `result` without calling the real tool
 *   - `after`   : call the real tool, then return `result` in place
 *                 of the real response
 *
 * The `after` mode deliberately produces a synthetic result that
 * the runner/bridge substitutes for the real one — the real side
 * effect has already happened and is recorded in the trajectory.
 */
export type InjectionDecision =
  | { mode: 'none' }
  | { mode: 'instead'; result: ToolCallResult }
  | { mode: 'after'; result: ToolCallResult };