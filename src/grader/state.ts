// src/grader/state.ts

import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { StateAssertion } from '../task/schema.js';
import type { AssertionResult } from './types.js';
import type { Snapshot } from '../sandbox/snapshot.js';
import { didFileChange } from '../sandbox/snapshot.js';
import { assertNever } from '../utils/assert-never.js';

/**
 * State assertion evaluator — verifies the END STATE of the workspace.
 *
 * Unlike tool-sequence matching, state assertions check WHAT the
 * environment looks like after the agent finishes. This allows
 * multiple valid solution paths to pass.
 */
export async function evaluateStateAssertion(
  assertion: StateAssertion,
  workspacePath: string,
  snapshotBefore: Snapshot,
  snapshotAfter: Snapshot
): Promise<AssertionResult> {
  const target = assertion.target;
  const absolute = resolve(workspacePath, target);

  // Safety: ensure target is within workspace
  const workspaceWithSep = workspacePath.endsWith(sep)
    ? workspacePath
    : workspacePath + sep;
  if (!absolute.startsWith(workspaceWithSep) && absolute !== workspacePath) {
    return {
      type: assertion.type,
      target,
      passed: false,
      message: `Path escapes workspace: ${target}`,
    };
  }

  try {
    switch (assertion.type) {
      case 'file_exists':
        return await checkFileExists(target, absolute);

      case 'file_changed':
        return checkFileChanged(target, snapshotBefore, snapshotAfter);

      case 'file_valid_json':
        return await checkFileValidJson(target, absolute);

      case 'file_contains':
        return await checkFileContains(target, absolute, assertion.value);

      case 'command_succeeded':
        return {
          type: assertion.type,
          target,
          passed: true,
          message: 'Command assertion delegated to sandbox',
        };

      default:
        return assertNever(assertion);
    }
  } catch (error) {
    return {
      type: assertion.type,
      target,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkFileExists(
  target: string,
  absolute: string
): Promise<AssertionResult> {
  try {
    await stat(absolute);
    return { type: 'file_exists', target, passed: true };
  } catch {
    return {
      type: 'file_exists',
      target,
      passed: false,
      message: `File does not exist: ${target}`,
    };
  }
}

function checkFileChanged(
  target: string,
  before: Snapshot,
  after: Snapshot
): AssertionResult {
  const changed = didFileChange(before, after, target);

  if (changed === null) {
    return {
      type: 'file_changed',
      target,
      passed: false,
      message: `File not found in either snapshot: ${target}`,
    };
  }

  return {
    type: 'file_changed',
    target,
    passed: changed,
    message: changed
      ? undefined
      : `File did not change during run: ${target}`,
  };
}

async function checkFileValidJson(
  target: string,
  absolute: string
): Promise<AssertionResult> {
  try {
    const content = await readFile(absolute, 'utf-8');
    JSON.parse(content);
    return { type: 'file_valid_json', target, passed: true };
  } catch (error) {
    return {
      type: 'file_valid_json',
      target,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkFileContains(
  target: string,
  absolute: string,
  value: string
): Promise<AssertionResult> {
  try {
    const content = await readFile(absolute, 'utf-8');
    const passed = content.includes(value);
    return {
      type: 'file_contains',
      target,
      passed,
      message: passed ? undefined : `File does not contain "${value}"`,
    };
  } catch (error) {
    return {
      type: 'file_contains',
      target,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}