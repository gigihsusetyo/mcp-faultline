// src/testing/integrity-smoke.ts

/**
 * Standalone smoke test for integrity assertions (Fase 10).
 *
 * Verifies that the grader:
 *   1. PASSES a good agent that writes output.txt exactly once
 *   2. FAILS a bad agent that writes output.txt twice
 *
 * The failing agent is the heart of this test — it is the first
 * "negative control" for integrity, proving that the
 * `file_written_exactly_once` assertion is not a no-op.
 *
 * Run:  node dist/testing/integrity-smoke.js
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTask } from '../task/loader.js';
import { runTask } from '../cli/runner.js';
import type {
  AgentStepState,
  AgentStepResult,
} from '../agent/embedded.js';
import type { RunResult } from '../report/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TASK_PATH = resolve(
    __dirname,
    '..',
    '..',
    'tasks',
    'integrity-only',
    'integrity-test-001.yaml'
  );

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/**
 * Good integrity agent — writes output.txt exactly once, then finishes.
 */
async function goodIntegrityStep(
  state: AgentStepState
): Promise<AgentStepResult> {
  if (state.stepIndex === 0) {
    return {
      action: 'call',
      toolName: 'write_file',
      args: { path: 'output.txt', content: 'hello integrity' },
    };
  }
  return {
    action: 'finish',
    message: 'Wrote output.txt once.',
  };
}

/**
 * Double-write agent — writes output.txt twice with the same content.
 * This is the classic idempotency violation: the agent retries a
 * write that already succeeded, producing a duplicate side-effect.
 */
async function doubleWriteStep(
  state: AgentStepState
): Promise<AgentStepResult> {
  if (state.stepIndex === 0) {
    return {
      action: 'call',
      toolName: 'write_file',
      args: { path: 'output.txt', content: 'hello integrity' },
    };
  }
  if (state.stepIndex === 1) {
    return {
      action: 'call',
      toolName: 'write_file',
      args: { path: 'output.txt', content: 'hello integrity' },
    };
  }
  return {
    action: 'finish',
    message: 'Wrote output.txt twice.',
  };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function check(name: string, cond: boolean, detail?: string): void {
  results.push({ name, passed: cond, detail });
  const mark = cond ? '✅' : '❌';
  process.stdout.write(`${mark} ${name}${detail ? ' — ' + detail : ''}\n`);
}

function findIntegrityResult(
  run: RunResult,
  target: string
): { passed: boolean; message?: string } | undefined {
  return run.grade.integrityResults.find((r) => r.target === target);
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

async function testGoodAgent(): Promise<void> {
  process.stdout.write('--- good agent (write once) ---\n');

  const task = await loadTask(TASK_PATH);
  const run = await runTask(task, goodIntegrityStep);

  check(
    'good agent passes grade',
    run.grade.passed === true,
    `summary: ${run.grade.summary}`
  );

  const integrity = findIntegrityResult(run, 'output.txt');
  check(
    'integrity assertion present',
    integrity !== undefined,
    integrity ? undefined : 'no integrity result for output.txt'
  );
  check(
    'integrity assertion passes',
    integrity?.passed === true,
    integrity?.message
  );
}

async function testDoubleWriteAgent(): Promise<void> {
  process.stdout.write('\n--- double-write agent (write twice) ---\n');

  const task = await loadTask(TASK_PATH);
  const run = await runTask(task, doubleWriteStep);

  check(
    'double-write agent fails grade',
    run.grade.passed === false,
    `summary: ${run.grade.summary}`
  );

  const integrity = findIntegrityResult(run, 'output.txt');
  check(
    'integrity assertion fails',
    integrity?.passed === false,
    integrity?.message
  );

  check(
    'failure message mentions count',
    typeof integrity?.message === 'string' &&
      /written 2 times/i.test(integrity.message),
    integrity?.message
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.stdout.write('=== integrity-smoke ===\n\n');

  await testGoodAgent();
  await testDoubleWriteAgent();

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  process.stdout.write(`\nTotal: ${passed}/${total} passed\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(
    `\nINTEGRITY SMOKE FAILED: ${
      err instanceof Error ? err.message : String(err)
    }\n`
  );
  process.exit(1);
});