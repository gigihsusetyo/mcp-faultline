// src/testing/index.ts

/**
 * Testing module — oracle validation utilities.
 *
 * Public API:
 * - Negative controls (good, bad retry, infinite loop, unsafe, hallucinating)
 * - runNegativeControls — run the full matrix
 * - formatNegativeControlResults — human-readable output
 * - Types: MatrixEntry, MatrixResult
 */

export * from './negative-controls/index.js';
export {
  runNegativeControls,
  formatNegativeControlResults,
} from './negative-controls/runner.js';
export type {
  MatrixEntry,
  MatrixResult,
} from './negative-controls/runner.js';