// src/fault/registry.ts

/**
 * Fault registry — single source of truth for all fault types.
 *
 * Why a registry?
 *   Adding a fault type today means touching 3 layers:
 *   - task/schema.ts       (zod enum)
 *   - fault/strategies.ts  (build synthetic result)
 *   - proxy/fault-runtime.ts  (runtime decision)
 *
 *   A registry collapses those into one file. Every layer reads
 *   from `FAULT_REGISTRY` instead of hardcoding its own switch.
 *
 * Scope:
 *   - 18 fault types across 6 categories
 *   - Idempotency violation is intentionally absent (needs
 *     "execute-then-fault" + side-effect ledger — deferred)
 *   - No plugin loader, no runtime registration, no DI
 */

import type { FaultInjection } from '../task/schema.js';
import type { ToolCallResult } from '../mcp/types.js';

// ---------------------------------------------------------------------------
// Fault type union
// ---------------------------------------------------------------------------

/**
 * The full union of fault type literals.
 *
 * This is the canonical definition. `task/schema.ts` re-exports it
 * for convenience, and the runtime `FAULT_TYPES` array below is
 * derived from `DEFINITIONS`.
 *
 * NOTE: keep this in sync with DEFINITIONS. A future refactor could
 * derive this automatically, but the current approach trades a small
 * amount of duplication for a clean, non-circular module graph.
 */
export type FaultType =
  | 'timeout'
  | 'latency'
  | 'disconnect'
  | 'rate_limit'
  | 'malformed_response'
  | 'invalid_schema'
  | 'missing_field'
  | 'empty'
  | 'partial_result'
  | 'stale'
  | 'contradictory'
  | 'wrong_value'
  | 'auth_expired'
  | 'forbidden'
  | 'delayed'
  | 'out_of_order'
  | 'replayed'
  | 'burst_failure'
  | 'server_outage'
  | 'cascading_failure';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * The 6 fault categories from Blueprint v0.2.
 * Used for grouping in reports and for future filter/selection.
 */
export type FaultCategory =
  | 'transport'
  | 'protocol'
  | 'data'
  | 'authorization'
  | 'temporal'
  | 'systemic';

export const FAULT_CATEGORIES: readonly FaultCategory[] = [
  'transport',
  'protocol',
  'data',
  'authorization',
  'temporal',
  'systemic',
];

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

/**
 * A single fault definition.
 *
 * `build` returns the synthetic ToolCallResult the injector should
 * return instead of calling the real tool. It receives the full
 * FaultInjection so callers can override message / delay_ms / etc.
 */
export interface FaultDefinition {
  readonly type: FaultType;
  readonly category: FaultCategory;
  readonly description: string;
  readonly build: (injection: FaultInjection) => ToolCallResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultMessage(injection: FaultInjection, fallback: string): string {
  return injection.message ?? fallback;
}

/**
 * Build a success-shaped result carrying fault metadata.
 *
 * Used by data-shape faults (empty, partial, stale, contradictory,
 * wrong_value) that need to look like a normal response so the agent
 * cannot tell from the wire format alone that something is wrong.
 */
function successWithMeta(
  data: unknown,
  meta: Record<string, unknown>
): ToolCallResult {
  return {
    status: 'success',
    data: { _fault: meta, data },
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const DEFINITIONS: readonly FaultDefinition[] = [
  // -------------------------------------------------------------------------
  // 1. Transport
  // -------------------------------------------------------------------------
  {
    type: 'timeout',
    category: 'transport',
    description: 'Tool call hangs and eventually times out',
    build: (inj) => ({
      status: 'timeout',
      message: defaultMessage(inj, `Simulated timeout on tool "${inj.tool}"`),
    }),
  },
  {
    type: 'latency',
    category: 'transport',
    description: 'Tool call succeeds but with abnormal delay',
    build: (inj) =>
      successWithMeta(
        { _note: defaultMessage(inj, 'Simulated latency spike') },
        {
          kind: 'latency',
          delay_ms: inj.duration_ms ?? 2000,
        }
      ),
  },
  {
    type: 'disconnect',
    category: 'transport',
    description: 'Transport connection drops mid-call',
    build: (inj) => ({
      status: 'error',
      code: 'TRANSPORT_DISCONNECT',
      message: defaultMessage(inj, `Simulated disconnect on tool "${inj.tool}"`),
    }),
  },
  {
    type: 'rate_limit',
    category: 'transport',
    description: 'Server rejects the call with a rate-limit error',
    build: (inj) => ({
      status: 'error',
      code: 'RATE_LIMIT',
      message: defaultMessage(
        inj,
        `Simulated rate limit on tool "${inj.tool}"`
      ),
    }),
  },

  // -------------------------------------------------------------------------
  // 2. Protocol
  // -------------------------------------------------------------------------
  {
    type: 'malformed_response',
    category: 'protocol',
    description: 'Tool returns a malformed/unparseable response',
    build: (inj) => ({
      status: 'malformed',
      raw: null,
      message: defaultMessage(
        inj,
        `Simulated malformed response from tool "${inj.tool}"`
      ),
    }),
  },
  {
    type: 'invalid_schema',
    category: 'protocol',
    description: 'Response parses but violates the declared schema',
    build: (inj) => ({
      status: 'malformed',
      raw: { _schema_violation: true },
      message: defaultMessage(
        inj,
        `Simulated schema violation from tool "${inj.tool}"`
      ),
    }),
  },
  {
    type: 'missing_field',
    category: 'protocol',
    description: 'Response is valid JSON but a required field is absent',
    build: (inj) => ({
      status: 'malformed',
      raw: { _missing_field: true },
      message: defaultMessage(
        inj,
        `Simulated missing field in response from tool "${inj.tool}"`
      ),
    }),
  },

  // -------------------------------------------------------------------------
  // 3. Data
  // -------------------------------------------------------------------------
  {
    type: 'empty',
    category: 'data',
    description: 'Tool reports success but returns an empty payload',
    build: (inj) =>
      successWithMeta(null, {
        kind: 'empty',
        note: defaultMessage(inj, 'Simulated empty result'),
      }),
  },
  {
    type: 'partial_result',
    category: 'data',
    description: 'Tool returns an incomplete result',
    build: (inj) =>
      successWithMeta(
        { _partial: true },
        {
          kind: 'partial',
          note: defaultMessage(inj, 'Simulated partial result'),
        }
      ),
  },
  {
    type: 'stale',
    category: 'data',
    description: 'Tool returns plausible but outdated data',
    build: (inj) =>
      successWithMeta(
        { _stale: true },
        {
          kind: 'stale',
          note: defaultMessage(inj, 'Simulated stale data'),
        }
      ),
  },
  {
    type: 'contradictory',
    category: 'data',
    description: 'Tool returns data that contradicts a prior result',
    build: (inj) =>
      successWithMeta(
        { _contradictory: true },
        {
          kind: 'contradictory',
          note: defaultMessage(inj, 'Simulated contradictory data'),
        }
      ),
  },
  {
    type: 'wrong_value',
    category: 'data',
    description: 'Tool returns a specific field with an incorrect value',
    build: (inj) =>
      successWithMeta(
        { _wrong_value: true },
        {
          kind: 'wrong_value',
          note: defaultMessage(inj, 'Simulated wrong value'),
        }
      ),
  },

  // -------------------------------------------------------------------------
  // 4. Authorization
  // -------------------------------------------------------------------------
  {
    type: 'auth_expired',
    category: 'authorization',
    description: 'Call fails because the auth token has expired',
    build: (inj) => ({
      status: 'error',
      code: 'AUTH_EXPIRED',
      message: defaultMessage(
        inj,
        `Simulated auth expiry on tool "${inj.tool}"`
      ),
    }),
  },
  {
    type: 'forbidden',
    category: 'authorization',
    description: 'Call is rejected because the caller lacks permission',
    build: (inj) => ({
      status: 'error',
      code: 'FORBIDDEN',
      message: defaultMessage(
        inj,
        `Simulated forbidden response from tool "${inj.tool}"`
      ),
    }),
  },

  // -------------------------------------------------------------------------
  // 5. Temporal
  // -------------------------------------------------------------------------
  {
    type: 'delayed',
    category: 'temporal',
    description: 'Response arrives after a long delay, still valid',
    build: (inj) =>
      successWithMeta(
        { _delayed: true },
        {
          kind: 'delayed',
          delay_ms: inj.duration_ms ?? 5000,
          note: defaultMessage(inj, 'Simulated delayed response'),
        }
      ),
  },
  {
    type: 'out_of_order',
    category: 'temporal',
    description: 'Response corresponds to a different (earlier) request',
    build: (inj) =>
      successWithMeta(
        { _out_of_order: true },
        {
          kind: 'out_of_order',
          note: defaultMessage(inj, 'Simulated out-of-order response'),
        }
      ),
  },
  {
    type: 'replayed',
    category: 'temporal',
    description: 'Response is a replay of a previous response',
    build: (inj) =>
      successWithMeta(
        { _replayed: true },
        {
          kind: 'replayed',
          note: defaultMessage(inj, 'Simulated replayed response'),
        }
      ),
  },

  // -------------------------------------------------------------------------
  // 6. Systemic
  // -------------------------------------------------------------------------
  {
    type: 'burst_failure',
    category: 'systemic',
    description: 'Many calls fail in a short window',
    build: (inj) => ({
      status: 'error',
      code: 'BURST_FAILURE',
      message: defaultMessage(
        inj,
        `Simulated burst failure on tool "${inj.tool}"`
      ),
    }),
  },
  {
    type: 'server_outage',
    category: 'systemic',
    description: 'Target server is entirely unreachable',
    build: (inj) => ({
      status: 'error',
      code: 'SERVER_OUTAGE',
      message: defaultMessage(
        inj,
        `Simulated server outage for tool "${inj.tool}"`
      ),
    }),
  },
  {
    type: 'cascading_failure',
    category: 'systemic',
    description: 'A failure in one call cascades to dependent calls',
    build: (inj) => ({
      status: 'error',
      code: 'CASCADING_FAILURE',
      message: defaultMessage(
        inj,
        `Simulated cascading failure from tool "${inj.tool}"`
      ),
    }),
  },
];

/**
 * The registry. Lookup is O(1) by fault type.
 */
export const FAULT_REGISTRY: ReadonlyMap<FaultType, FaultDefinition> = new Map(
  DEFINITIONS.map((def) => [def.type, def])
);

/**
 * All registered fault types, in declaration order.
 * Derived from the registry so zod schemas stay in sync.
 */
export const FAULT_TYPES: readonly FaultType[] = DEFINITIONS.map(
  (d) => d.type
);

/**
 * All definitions, in declaration order. Useful for iteration
 * (reports, docs, tests).
 */
export const FAULT_DEFINITIONS: readonly FaultDefinition[] = DEFINITIONS;

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Look up a fault definition. Throws if the type is unknown —
 * this should never happen at runtime because the zod schema
 * already validates the input.
 */
export function getFaultDefinition(type: FaultType): FaultDefinition {
  const def = FAULT_REGISTRY.get(type);
  if (!def) {
    throw new Error(`Unknown fault type: ${String(type)}`);
  }
  return def;
}

/**
 * Group fault types by category. Used by reports.
 */
export function groupFaultsByCategory(): Readonly<
  Record<FaultCategory, readonly FaultType[]>
> {
  const groups: Record<FaultCategory, FaultType[]> = {
    transport: [],
    protocol: [],
    data: [],
    authorization: [],
    temporal: [],
    systemic: [],
  };
  for (const def of DEFINITIONS) {
    groups[def.category].push(def.type);
  }
  return groups;
}