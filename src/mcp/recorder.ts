// src/mcp/recorder.ts

import type { ToolCallRecord, ToolCallResult } from './types.js';

/**
 * Recorder utilities — helpers for building ToolCallRecord objects
 * and computing statistics from trajectories.
 */

/**
 * Build a ToolCallRecord from raw inputs.
 *
 * `executed` must be supplied by the caller — it indicates whether
 * the real tool ran (side-effects may exist) or was short-circuited.
 * This is required, not optional, to force the caller to be explicit.
 */
export function buildToolCallRecord(params: {
  index: number;
  toolName: string;
  args: unknown;
  result: ToolCallResult;
  startedAt: number;
  endedAt: number;
  executed: boolean;
}): ToolCallRecord {
  return {
    index: params.index,
    toolName: params.toolName,
    args: params.args,
    result: params.result,
    startedAt: params.startedAt,
    durationMs: params.endedAt - params.startedAt,
    executed: params.executed,
  };
}

/**
 * Detect if the trajectory contains a loop — repeated identical calls.
 *
 * A loop is defined as N or more consecutive calls with the same
 * tool name and identical arguments.
 */
export function detectLoop(
  calls: readonly ToolCallRecord[],
  threshold = 3
): { toolName: string; args: unknown; count: number } | null {
  if (calls.length < threshold) {
    return null;
  }

  let consecutiveCount = 1;
  let previous = calls[0];

  for (let i = 1; i < calls.length; i++) {
    const current = calls[i];
    const sameTool = current.toolName === previous.toolName;
    const sameArgs =
      JSON.stringify(current.args) === JSON.stringify(previous.args);

    if (sameTool && sameArgs) {
      consecutiveCount++;
      if (consecutiveCount >= threshold) {
        return {
          toolName: current.toolName,
          args: current.args,
          count: consecutiveCount,
        };
      }
    } else {
      consecutiveCount = 1;
    }

    previous = current;
  }

  return null;
}

/**
 * Count calls by tool name.
 */
export function countCallsByTool(
  calls: readonly ToolCallRecord[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const call of calls) {
    counts[call.toolName] = (counts[call.toolName] ?? 0) + 1;
  }
  return counts;
}

/**
 * Count calls by result status.
 */
export function countCallsByStatus(
  calls: readonly ToolCallRecord[]
): Record<ToolCallResult['status'], number> {
  const counts: Record<ToolCallResult['status'], number> = {
    success: 0,
    error: 0,
    timeout: 0,
    malformed: 0,
    policy_violation: 0,
  };
  for (const call of calls) {
    counts[call.result.status]++;
  }
  return counts;
}