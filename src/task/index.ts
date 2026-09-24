// src/task/index.ts

/**
 * Task module — specification, loading, and validation.
 *
 * Public API:
 * - loadTask / loadTasks — load and validate from YAML
 * - validateTask — programmatic validation
 * - Types: Task, FaultInjection, Grader, etc.
 */

export * from './schema.js';
export * from './loader.js';
export * from './validator.js';