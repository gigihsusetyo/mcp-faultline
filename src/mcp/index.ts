// src/mcp/index.ts

/**
 * MCP module — observer, trajectory recording, and tool call tracking.
 *
 * Public API:
 * - Observer — interface for intercepting tool calls
 * - TrajectoryRecorder — MVP observer that records all calls
 * - Types: ToolCallRecord, ToolCallResult, Trajectory
 * - Utilities: buildToolCallRecord, detectLoop, countCallsByTool
 */

export * from './types.js';
export * from './observer.js';
export * from './recorder.js';