// src/report/index.ts

/**
 * Report module — generate human- and machine-readable output.
 *
 * Public API:
 * - computeStats — batch statistics with confidence intervals
 * - toJson / writeJson — JSON output
 * - toMarkdown / writeMarkdown — Markdown output
 * - Types: RunResult, BatchReport, BatchStats
 */

export * from './types.js';
export * from './stats.js';
export * from './json.js';
export * from './markdown.js';