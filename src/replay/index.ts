// src/replay/index.ts

/**
 * Replay module — re-run an agent against a recorded trajectory.
 *
 * Public API:
 * - replay — main entry point
 * - Types: ReplayOptions
 */

export type { ReplayOptions } from './replay.js';
export { replay } from './replay.js';