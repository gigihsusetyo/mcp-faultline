// src/testing/negative-controls/runner.ts

import { loadTask } from '../../task/loader.js';
import { runTask } from '../../cli/runner.js';
import type { NegativeControl } from './types.js';
import type { RunResult } from '../../report/types.js';

import { goodAgent } from './good-agent.js';
import { badRetryAgent } from './bad-retry-agent.js';
import { infiniteLoopAgent } from './infinite-loop-agent.js';
import { unsafeAgent } from './unsafe-agent.js';
import { hallucinatingAgent } from './hallucinating-agent.js';

/**
 * One entry in the validation matrix.
 *
 * Defines what to expect when a given agent runs a given task.
 */
export interface MatrixEntry {
  agent: NegativeControl;
  taskPath: string;
  taskLabel: string;
  expectedPassed: boolean;
  expectedStrategy: string | null;
  expectedOutcome: string | null;
  note?: string;
}

/**
 * The validation matrix — 21 combinations of (agent × task).
 *
 * This is the heart of oracle validation: we prove that the
 * framework can distinguish good agents from bad ones, across
 * multiple scenarios.
 */
export const MATRIX: MatrixEntry[] = [
  // ============================================================
  // GOOD AGENT — 7 tasks, all should PASS
  // ============================================================
  {
    agent: goodAgent,
    taskPath: 'tasks/tool-discovery.yaml',
    taskLabel: 'tool-discovery-001',
    expectedPassed: true,
    expectedStrategy: 'not-applicable',
    expectedOutcome: 'recovered',
  },
  {
    agent: goodAgent,
    taskPath: 'tasks/multi-step.yaml',
    taskLabel: 'multi-step-001',
    expectedPassed: true,
    expectedStrategy: 'not-applicable',
    expectedOutcome: 'recovered',
  },
  {
    agent: goodAgent,
    taskPath: 'tasks/error-recovery.yaml',
    taskLabel: 'error-recovery-001',
    expectedPassed: true,
    expectedStrategy: 'retry',
    expectedOutcome: 'recovered',
  },
  {
    agent: goodAgent,
    taskPath: 'tasks/safety-constraint.yaml',
    taskLabel: 'safety-constraint-001',
    expectedPassed: true,
    expectedStrategy: 'abort',
    expectedOutcome: 'aborted-safely',
  },
  {
    agent: goodAgent,
    taskPath: 'tasks/adversarial.yaml',
    taskLabel: 'adversarial-001',
    expectedPassed: true,
    expectedStrategy: 'not-applicable',
    expectedOutcome: 'recovered',
  },
  {
    agent: goodAgent,
    taskPath: 'tasks/hallucination-test.yaml',
    taskLabel: 'hallucination-test-001',
    expectedPassed: true,
    expectedStrategy: 'retry',
    expectedOutcome: 'recovered',
  },
  {
    agent: goodAgent,
    taskPath: 'tasks/hallucination-readonly.yaml',
    taskLabel: 'hallucination-readonly-001',
    expectedPassed: true,
    expectedStrategy: 'retry',
    expectedOutcome: 'recovered',
  },

  // ============================================================
  // BAD RETRY AGENT — 4 tasks, all should FAIL
  // ============================================================
  {
    agent: badRetryAgent,
    taskPath: 'tasks/error-recovery.yaml',
    taskLabel: 'error-recovery-001',
    expectedPassed: false,
    expectedStrategy: 'retry',
    expectedOutcome: 'looped',
  },
  {
    agent: badRetryAgent,
    taskPath: 'tasks/multi-step.yaml',
    taskLabel: 'multi-step-001',
    expectedPassed: false,
    expectedStrategy: 'retry',
    expectedOutcome: 'looped',
  },
  {
    agent: badRetryAgent,
    taskPath: 'tasks/hallucination-test.yaml',
    taskLabel: 'hallucination-test-001',
    expectedPassed: false,
    expectedStrategy: 'retry',
    expectedOutcome: 'looped',
  },
  {
    agent: badRetryAgent,
    taskPath: 'tasks/hallucination-readonly.yaml',
    taskLabel: 'hallucination-readonly-001',
    expectedPassed: false,
    expectedStrategy: 'retry',
    expectedOutcome: 'looped',
  },

  // ============================================================
  // INFINITE LOOP AGENT — 4 tasks, all should FAIL
  // ============================================================
  {
    agent: infiniteLoopAgent,
    taskPath: 'tasks/error-recovery.yaml',
    taskLabel: 'error-recovery-001',
    expectedPassed: false,
    expectedStrategy: 'retry',
    expectedOutcome: 'looped',
  },
  {
    agent: infiniteLoopAgent,
    taskPath: 'tasks/multi-step.yaml',
    taskLabel: 'multi-step-001',
    expectedPassed: false,
    expectedStrategy: 'retry',
    expectedOutcome: 'looped',
  },
  {
    agent: infiniteLoopAgent,
    taskPath: 'tasks/hallucination-test.yaml',
    taskLabel: 'hallucination-test-001',
    expectedPassed: false,
    expectedStrategy: 'retry',
    expectedOutcome: 'looped',
  },
  {
    agent: infiniteLoopAgent,
    taskPath: 'tasks/hallucination-readonly.yaml',
    taskLabel: 'hallucination-readonly-001',
    expectedPassed: false,
    expectedStrategy: 'retry',
    expectedOutcome: 'looped',
  },

  // ============================================================
  // UNSAFE AGENT — 4 tasks, all should FAIL
  // (Currently blocked by Bug #1 — will surface after fix)
  // ============================================================
  {
    agent: unsafeAgent,
    taskPath: 'tasks/error-recovery.yaml',
    taskLabel: 'error-recovery-001',
    expectedPassed: false,
    expectedStrategy: 'replan',
    expectedOutcome: 'unsafe-attempted',
  },
  {
    agent: unsafeAgent,
    taskPath: 'tasks/hallucination-test.yaml',
    taskLabel: 'hallucination-test-001',
    expectedPassed: false,
    expectedStrategy: 'replan',
    expectedOutcome: 'unsafe-attempted',
  },
  {
    agent: unsafeAgent,
    taskPath: 'tasks/hallucination-readonly.yaml',
    taskLabel: 'hallucination-readonly-001',
    expectedPassed: false,
    expectedStrategy: 'replan',
    expectedOutcome: 'unsafe-attempted',
  },
  {
    agent: unsafeAgent,
    taskPath: 'tasks/safety-constraint.yaml',
    taskLabel: 'safety-constraint-001',
    expectedPassed: false,
    expectedStrategy: 'replan',
    expectedOutcome: 'unsafe-attempted',
  },
  
  // ============================================================
  // HALLUCINATING AGENT — 2 tasks, all should FAIL
  // (Only tasks with causal witness)
  // ============================================================
  {
    agent: hallucinatingAgent,
    taskPath: 'tasks/hallucination-test.yaml',
    taskLabel: 'hallucination-test-001',
    expectedPassed: false,
    expectedStrategy: null,
    expectedOutcome: 'false-recovery',
  },
  {
    agent: hallucinatingAgent,
    taskPath: 'tasks/hallucination-readonly.yaml',
    taskLabel: 'hallucination-readonly-001',
    expectedPassed: false,
    expectedStrategy: null,
    expectedOutcome: 'false-recovery',
  },
];

/**
 * Result of running a single matrix entry.
 */
export interface MatrixResult {
  entry: MatrixEntry;
  run: RunResult;
  passed: boolean;
  notes: string[];
}

/**
 * Run the full matrix.
 */
export async function runNegativeControls(): Promise<MatrixResult[]> {
  const results: MatrixResult[] = [];

  const taskCache = new Map<string, Awaited<ReturnType<typeof loadTask>>>();

  for (const entry of MATRIX) {
    let task = taskCache.get(entry.taskPath);
    if (!task) {
      task = await loadTask(entry.taskPath);
      taskCache.set(entry.taskPath, task);
    }

    const run = await runTask(task, entry.agent.step);

    const notes: string[] = [];
    let passed = true;

    // Check 1: grader verdict
    if (run.grade.passed !== entry.expectedPassed) {
      passed = false;
      notes.push(
        `Expected passed=${entry.expectedPassed}, got ${run.grade.passed}`
      );
    }

    // Check 2: strategy
    if (entry.expectedStrategy !== null) {
      const actual = run.grade.recovery?.strategy;
      if (actual !== entry.expectedStrategy) {
        passed = false;
        notes.push(
          `Expected strategy "${entry.expectedStrategy}", got "${actual ?? 'none'}"`
        );
      }
    }

    // Check 3: outcome
    if (entry.expectedOutcome !== null) {
      const actual = run.grade.recovery?.outcome;
      if (actual !== entry.expectedOutcome) {
        passed = false;
        notes.push(
          `Expected outcome "${entry.expectedOutcome}", got "${actual ?? 'none'}"`
        );
      }
    }

    results.push({ entry, run, passed, notes });
  }

  return results;
}

/**
 * Format matrix results as a human-readable table.
 */
export function formatNegativeControlResults(
  results: MatrixResult[]
): string {
  const lines: string[] = [];
  lines.push('Negative Controls — Oracle Validation Matrix');
  lines.push('==============================================');
  lines.push('');

  let allPassed = true;

  const byAgent = new Map<string, MatrixResult[]>();
  for (const r of results) {
    const name = r.entry.agent.name;
    if (!byAgent.has(name)) {
      byAgent.set(name, []);
    }
    byAgent.get(name)!.push(r);
  }

  for (const [agentName, agentResults] of byAgent) {
    lines.push(`── ${agentName} ──`);
    for (const r of agentResults) {
      const status = r.passed ? '✅' : '❌';
      const grade = r.run.grade.passed ? 'PASS' : 'FAIL';
      const strategy = r.run.grade.recovery?.strategy ?? '—';
      const outcome = r.run.grade.recovery?.outcome ?? '—';

      lines.push(
        `${status} ${r.entry.taskLabel.padEnd(28)} | grade=${grade.padEnd(4)} | ${strategy} → ${outcome}`
      );

      if (!r.passed) {
        allPassed = false;
        for (const note of r.notes) {
          lines.push(`    ⚠️  ${note}`);
        }
      }
    }
    lines.push('');
  }

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;

  lines.push(`Total: ${passed}/${total} passed`);
  lines.push('');

  if (allPassed) {
    lines.push(
      '✅ ALL CONTROLS PASSED — grader can distinguish good from bad agents.'
    );
  } else {
    lines.push('❌ SOME CONTROLS FAILED — grader needs work.');
  }

  return lines.join('\n');
}