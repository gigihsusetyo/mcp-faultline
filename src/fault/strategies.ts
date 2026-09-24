// src/fault/strategies.ts

/**
 * Fault strategies — thin wrappers over the fault registry.
 *
 * The heavy lifting (synthetic result construction) lives in
 * `registry.ts`. This module exposes the stable helpers that
 * existing callers already depend on:
 *
 *   - buildFaultResult   → look up definition, call build()
 *   - matchesFault       → tool name + call number match
 *   - FAULT_DESCRIPTIONS → derived from registry
 *
 * Keeping this file thin means adding a fault type only touches
 * `registry.ts` — not three separate switches.
 */

import type { FaultInjection } from '../task/schema.js';
import type { ToolCallResult } from '../mcp/types.js';
import {
  getFaultDefinition,
  FAULT_DEFINITIONS,
  type FaultCategory,
  type FaultType,
} from './registry.js';

export type { FaultCategory };
export {
  FAULT_CATEGORIES,
  FAULT_TYPES,
  FAULT_DEFINITIONS,
} from './registry.js';

/**
 * Build a synthetic result for a given fault injection.
 *
 * Delegates to the registry. Throws if the fault type is unknown
 * (defensive — the zod schema should have rejected it earlier).
 */
export function buildFaultResult(fault: FaultInjection): ToolCallResult {
  return getFaultDefinition(fault.fault as FaultType).build(fault);
}

/**
 * Check if a fault should be injected on a given call.
 *
 * A fault matches when:
 * - tool name matches
 * - call number matches (1-based, per tool)
 */
export function matchesFault(
  fault: FaultInjection,
  toolName: string,
  callNumber: number
): boolean {
  return fault.tool === toolName && fault.call_number === callNumber;
}

/**
 * Fault type descriptions — derived from the registry.
 *
 * Kept as a plain object so existing report code that does
 * `FAULT_DESCRIPTIONS[type]` continues to work.
 */
export const FAULT_DESCRIPTIONS: Record<FaultType, string> = Object.fromEntries(
  FAULT_DEFINITIONS.map((def) => [def.type, def.description])
) as Record<FaultType, string>;