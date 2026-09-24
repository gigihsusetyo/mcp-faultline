// src/index.ts

/**
 * MCP-Faultline — Failure-mode evaluation for MCP agents.
 *
 * Inject faults, observe trajectory, grade resilience.
 *
 * This is the public API entry point. CLI is in src/cli.ts.
 */

export * from './task/index.js';
export * from './sandbox/index.js';
export * from './mcp/index.js';
export * from './agent/index.js';
export * from './fault/index.js';
export * from './grader/index.js';
export * from './report/index.js';