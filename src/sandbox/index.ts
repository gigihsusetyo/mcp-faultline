// src/sandbox/index.ts

/**
 * Sandbox module — isolated execution environments.
 *
 * Public API:
 * - Sandbox — interface for all sandbox implementations
 * - TempFolderSandbox — MVP implementation (OS temp directory)
 * - CleanupRegistry — track and clean up sandboxes on exit
 * - takeSnapshot / compareSnapshots / didFileChange — file change detection
 */

export * from './interface.js';
export * from './temp-folder.js';
export * from './cleanup.js';
export * from './snapshot.js';