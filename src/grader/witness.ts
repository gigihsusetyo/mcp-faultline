// src/grader/witness.ts

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Witness } from '../task/schema.js';
import type { Trajectory } from '../mcp/types.js';
import type { Snapshot } from '../sandbox/snapshot.js';
import type { WitnessResult } from './types.js';
import { didFileChange } from '../sandbox/snapshot.js';

/**
 * Evaluate a witness against a run.
 *
 * A witness is causal evidence that the agent actually worked:
 * - state_delta: a file must have changed during the run
 * - content_match: a value from a source must appear in a target
 *
 * Unlike state assertions, a witness cannot be satisfied by
 * pre-seeded state alone. It requires agent action.
 */
export async function evaluateWitness(
  witness: Witness,
  trajectory: Trajectory,
  workspacePath: string,
  snapshotBefore: Snapshot,
  snapshotAfter: Snapshot
): Promise<WitnessResult> {
  switch (witness.type) {
    case 'state_delta':
      return evaluateStateDelta(
        witness.target,
        witness.must_change,
        snapshotBefore,
        snapshotAfter
      );

    case 'content_match':
      return await evaluateContentMatch(
        witness.source,
        witness.target,
        workspacePath,
        trajectory
      );

    default: {
      const _exhaustive: never = witness;
      throw new Error(
        `Unknown witness type: ${JSON.stringify(_exhaustive)}`
      );
    }
  }
}

/**
 * Check that a file changed during the run.
 */
function evaluateStateDelta(
  target: string,
  mustChange: boolean,
  before: Snapshot,
  after: Snapshot
): WitnessResult {
  const changed = didFileChange(before, after, target);

  if (changed === null) {
    return {
      type: 'state_delta',
      passed: false,
      message: `File "${target}" not found in either snapshot`,
    };
  }

  if (mustChange && !changed) {
    return {
      type: 'state_delta',
      passed: false,
      message: `File "${target}" did not change during the run`,
    };
  }

  if (!mustChange && changed) {
    return {
      type: 'state_delta',
      passed: false,
      message: `File "${target}" changed but should not have`,
    };
  }

  return {
    type: 'state_delta',
    passed: true,
    message: `File "${target}" ${changed ? 'changed' : 'unchanged'} as expected`,
  };
}

/**
 * Check that a value from a source appears in a target.
 *
 * The target may be:
 * - A file path (relative to workspace)
 * - The special token "agent_final_message" (the agent's final message)
 *
 * The source is always a file path (relative to workspace).
 */
async function evaluateContentMatch(
  source: string,
  target: string,
  workspacePath: string,
  trajectory: Trajectory
): Promise<WitnessResult> {
  // Read the source content
  let sourceContent: string;
  try {
    const sourcePath = resolve(workspacePath, source);
    sourceContent = await readFile(sourcePath, 'utf-8');
  } catch (error) {
    return {
      type: 'content_match',
      passed: false,
      message: `Failed to read source "${source}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  // Get the target content
  let targetContent: string;
  if (target === 'agent_final_message') {
    targetContent = trajectory.agentFinalMessage ?? '';
    if (!targetContent) {
      return {
        type: 'content_match',
        passed: false,
        message: 'Agent final message is empty',
      };
    }
  } else {
    try {
      const targetPath = resolve(workspacePath, target);
      targetContent = await readFile(targetPath, 'utf-8');
    } catch (error) {
      return {
        type: 'content_match',
        passed: false,
        message: `Failed to read target "${target}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  // Extract a meaningful token from source content
  // For JSON files: try to find a nonce-like key
  const token = extractWitnessToken(sourceContent);

  if (!token) {
    return {
      type: 'content_match',
      passed: false,
      message: `No witness token found in source "${source}"`,
    };
  }

  // Check if the token appears in the target
  const matched = targetContent.includes(token);

  return {
    type: 'content_match',
    passed: matched,
    message: matched
      ? `Token "${token}" found in "${target}"`
      : `Token "${token}" from "${source}" not found in "${target}"`,
  };
}

/**
 * Extract a witness token from source content.
 *
 * Looks for:
 * - A key called "nonce", "FAULTLINE_NONCE", or "witness_token"
 * - Falls back to the whole content if no key is found
 */
function extractWitnessToken(content: string): string | null {
  // Try JSON parse
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null) {
      const nonce =
        parsed.nonce ??
        parsed.FAULTLINE_NONCE ??
        parsed.witness_token ??
        parsed.witnessToken;
      if (typeof nonce === 'string' && nonce.length > 0) {
        return nonce;
      }
    }
  } catch {
    // Not JSON — try key=value format
  }

  // Try key=value format
  const match = /(?:FAULTLINE_NONCE|nonce|witness_token)\s*[:=]\s*(\S+)/i.exec(
    content
  );
  if (match) {
    return match[1];
  }

  // Fallback: if content is short, use the whole content
  const trimmed = content.trim();
  if (trimmed.length > 0 && trimmed.length <= 200) {
    return trimmed;
  }

  return null;
}