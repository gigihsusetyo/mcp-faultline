// src/testing/idempotency-smoke.ts

/**
 * Standalone smoke test for idempotency violations (Fase 8.5).
 *
 * Proves that a fault injected with `mode: after` produces a real
 * side-effect that the integrity layer can catch.
 *
 * Scenario:
 *   1. Agent calls write_file(output.txt, "hello idempotency")
 *   2. The write SUCCEEDS on disk.
 *   3. The proxy/runner replaces the response with a timeout.
 *   4. The agent, believing the write failed, retries.
 *   5. The retry writes the file a second time.
 *   6. The integrity assertion `file_written_exactly_once` FAILS.
 *
 * This is the showcase for "state > sequence": a sequence-based
 * grader would just see two write calls; a state-based grader sees
 * the actual side-effect (two writes for a file that should have
 * exactly one).
 *
 * Run:  node dist/testing/idempotency-smoke.js
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
  'idempotency-test-001.yaml'
);

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/**
 * Naive agent — retries on error without checking whether the
 * previous attempt actually succeeded. This is the "idempotency-
 * unaware" behavior we want to catch.
 *
 * Steps:
 *   0. Call write_file.
 *   1. If previous call resulted in an error, retry.
 *   2. Finish.
 */
async function naiveStep(state: AgentStepState): Promise<AgentStepResult> {
  const { stepIndex, history } = state;

  if (stepIndex === 0) {
    return {
      action: 'call',
      toolName: 'write_file',
      args: { path: 'output.txt', content: 'hello idempotency' },
    };
  }

  const prev = history[stepIndex - 1];

  if (prev?.result.status === 'error' && stepIndex < 3) {
    // Retry — the agent does NOT verify whether the first write
    // already reached the server.
    return {
      action: 'call',
      toolName: 'write_file',
      args: { path: 'output.txt', content: 'hello idempotency' },
    };
  }

  return {
    action: 'finish',
    message: 'Wrote output.txt.',
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

function countExecutedWriteCalls(run: RunResult): number {
    return run.trajectory.calls.filter(
      (c) => c.toolName === 'write_file' && c.executed
    ).length;
  }

// ---------------------------------------------------------------------------
// Test case
// ---------------------------------------------------------------------------

async function testIdempotencyViolation(): Promise<void> {
  process.stdout.write('--- idempotency violation (mode: after) ---\n');

  const task = await loadTask(TASK_PATH);
  const run = await runTask(task, naiveStep);

  // 1. Two write attempts should be recorded.
  const writeCalls = countExecutedWriteCalls(run);
  check(
    'agent made 2 successful write calls',
    writeCalls === 2,
    `recorded ${writeCalls} successful write call(s)`
  );

  // 2. The final grade must FAIL.
  check(
    'grade fails (integrity violation detected)',
    run.grade.passed === false,
    `summary: ${run.grade.summary}`
  );

  // 3. The failing assertion must be integrity-related.
  const integrity = run.grade.integrityResults.find(
    (r) => r.target === 'output.txt'
  );
  check(
    'integrity assertion fails',
    integrity?.passed === false,
    integrity?.message
  );

  // 4. The failure message must mention the count.
  check(
    'failure message mentions "2 times"',
    typeof integrity?.message === 'string' &&
      /written 2 times/i.test(integrity.message),
    integrity?.message
  );

  // 5. The file MUST exist (the first write really landed).
  const fileAssertion = run.grade.stateResults.find(
    (r) => r.target === 'output.txt' && r.type === 'file_exists'
  );
  check(
    'file was actually written (side-effect happened)',
    fileAssertion?.passed === true,
    fileAssertion?.message
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.stdout.write('=== idempotency-smoke ===\n\n');

  await testIdempotencyViolation();

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  process.stdout.write(`\nTotal: ${passed}/${total} passed\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(
    `\nIDEMPOTENCY SMOKE FAILED: ${
      err instanceof Error ? err.message : String(err)
    }\n`
  );
  process.exit(1);
});