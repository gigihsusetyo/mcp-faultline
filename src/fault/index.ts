// src/fault/index.ts

/**
 * Fault module — inject synthetic failures into tool calls.
 *
 * The fault injector sits between the agent and the real tools.
 * When a fault matches (by tool name + call number), the real tool
 * is never called — a synthetic result is returned instead.
 *
 * This is the core of MCP-Faultline's differentiation:
 * we don't just inject faults — we grade the agent's response.
 *
 * Public API:
 * - FaultInjector — interface
 * - PlanFaultInjector — plan-based injector (from task spec)
 * - NoopFaultInjector — no faults (baseline)
 * - buildFaultResult, matchesFault — utilities
 */

export * from './types.js';
export * from './strategies.js';
export * from './injector.js';