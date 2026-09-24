// src/cli/index.ts

import { Command } from 'commander';
import { readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { runTasks } from './runner.js';
import { computeStats } from '../report/stats.js';
import { writeJson } from '../report/json.js';
import { writeMarkdown } from '../report/markdown.js';
import type { BatchReport } from '../report/types.js';
import type {
  AgentStepState,
  AgentStepResult,
} from '../agent/embedded.js';
import { runProxyCommand } from './proxy-command.js';
import { runReplayCommand } from './replay-command.js';

/**
 * CLI for MCP-Faultline.
 *
 * Commands:
 *   run                — run tasks and produce a report
 *   list               — list available tasks
 *   negative-controls  — run oracle validation (negative controls)
 *   proxy              — stdio proxy for external MCP agents
 *   replay             — re-run an agent against a recorded trajectory
 */
export function createCli(): Command {
  const program = new Command();

  program
    .name('mcp-faultline')
    .description(
      'Failure-mode evaluation for MCP agents — inject faults, observe trajectory, grade resilience.'
    )
    .version('0.2.0');

  program
    .command('run')
    .description('Run a task suite and produce a report')
    .option('-t, --tasks <dir>', 'Directory containing task YAML files', 'tasks')
    .option('-r, --runs <n>', 'Runs per task', '1')
    .option('-o, --out <dir>', 'Output directory', 'reports')
    .option('--json', 'Write JSON report', true)
    .option('--md', 'Write Markdown report', true)
    .action(async (opts) => {
      await runCommand({
        tasksDir: opts.tasks,
        runsPerTask: Number(opts.runs),
        outDir: opts.out,
        writeJsonReport: opts.json,
        writeMarkdownReport: opts.md,
      });
    });

  program
    .command('list')
    .description('List available task YAML files')
    .option('-t, --tasks <dir>', 'Directory containing task YAML files', 'tasks')
    .action(async (opts) => {
      const dir = resolve(opts.tasks);
      const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml'));
      for (const file of files) {
        console.log(join(dir, file));
      }
    });

  program
    .command('negative-controls')
    .description('Run oracle validation — full matrix of agents × tasks')
    .action(async () => {
      const { runNegativeControls, formatNegativeControlResults } = await import(
        '../testing/negative-controls/runner.js'
      );
      const results = await runNegativeControls();
      console.log(formatNegativeControlResults(results));
      const allPassed = results.every((r) => r.passed);
      process.exit(allPassed ? 0 : 1);
    });

  program
    .command('proxy')
    .description(
      'Run stdio proxy between an external MCP agent and a real MCP server'
    )
    .requiredOption(
      '--server <cmd>',
      'Server command line, e.g. "node server.js --port 3000"'
    )
    .option(
      '--task <path>',
      'Optional task YAML — only its fault_injection array is used'
    )
    .option('--cwd <path>', 'Working directory for the spawned server')
    .action(async (opts) => {
      const code = await runProxyCommand({
        server: opts.server,
        task: opts.task,
        cwd: opts.cwd,
      });
      process.exit(code);
    });

  program
    .command('replay')
    .description('Re-run an agent against a recorded trajectory')
    .argument('<path>', 'Path to a RunResult or BatchReport JSON file')
    .option('--run-id <id>', 'Select a specific run from a BatchReport')
    .option(
      '-t, --tasks <dir>',
      'Directory containing task YAML files',
      'tasks'
    )
    .action(async (sourcePath: string, opts) => {
      const code = await runReplayCommand({
        source: sourcePath,
        runId: opts.runId,
        tasksDir: opts.tasks,
      });
      process.exit(code);
    });

  return program;
}

interface RunCommandOptions {
  tasksDir: string;
  runsPerTask: number;
  outDir: string;
  writeJsonReport: boolean;
  writeMarkdownReport: boolean;
}

/**
 * Default step function — a simple deterministic agent.
 *
 * For each task, the agent follows a task-specific policy.
 * This is intentionally simplistic — the goal is to demonstrate
 * the harness, not the agent.
 *
 * Exported so the replay command can re-run the same agent
 * against a recorded trajectory.
 */
export function defaultStep(state: AgentStepState): Promise<AgentStepResult> {
  const { context, stepIndex } = state;

  // tool-discovery: read README.md
  if (context.taskId === 'tool-discovery-001') {
    if (stepIndex === 0) {
      return Promise.resolve({
        action: 'call',
        toolName: 'read_file',
        args: { path: 'README.md' },
      });
    }
    return Promise.resolve({
      action: 'finish',
      message: 'Read README.md',
    });
  }

  // multi-step: read config.json, write version to output.txt
  if (context.taskId === 'multi-step-001') {
    if (stepIndex === 0) {
      return Promise.resolve({
        action: 'call',
        toolName: 'read_file',
        args: { path: 'config.json' },
      });
    }
    if (stepIndex === 1) {
      const prev = state.history[0];
      const data = prev?.result?.data;
      let version = 'unknown';
      try {
        const parsed =
          typeof data === 'string'
            ? JSON.parse(data)
            : (data as { version?: string });
        version = parsed?.version ?? 'unknown';
      } catch {
        version = 'unknown';
      }
      return Promise.resolve({
        action: 'call',
        toolName: 'write_file',
        args: { path: 'output.txt', content: version },
      });
    }
    return Promise.resolve({
      action: 'finish',
      message: 'Wrote version to output.txt',
    });
  }

  // error-recovery: retry read_file after first timeout
  if (context.taskId === 'error-recovery-001') {
    if (stepIndex === 0) {
      return Promise.resolve({
        action: 'call',
        toolName: 'read_file',
        args: { path: 'config.json' },
      });
    }
    if (stepIndex === 1) {
      return Promise.resolve({
        action: 'call',
        toolName: 'read_file',
        args: { path: 'config.json' },
      });
    }
    return Promise.resolve({
      action: 'finish',
      message: 'Recovered after timeout',
    });
  }

  // safety-constraint: refuse to delete — just finish
  if (context.taskId === 'safety-constraint-001') {
    return Promise.resolve({
      action: 'finish',
      message: 'Refused to delete deprecated.txt (policy violation)',
    });
  }

  // adversarial: move report.txt to archive/
  if (context.taskId === 'adversarial-001') {
    if (stepIndex === 0) {
      return Promise.resolve({
        action: 'call',
        toolName: 'move_file',
        args: { from: 'report.txt', to: 'archive/report.txt' },
      });
    }
    return Promise.resolve({
      action: 'finish',
      message: 'Archived report.txt',
    });
  }

  // hallucination-test: retry read_file, then write output.txt
  if (context.taskId === 'hallucination-test-001') {
    if (stepIndex === 0) {
      return Promise.resolve({
        action: 'call',
        toolName: 'read_file',
        args: { path: 'config.json' },
      });
    }
    if (stepIndex === 1) {
      return Promise.resolve({
        action: 'call',
        toolName: 'read_file',
        args: { path: 'config.json' },
      });
    }
    if (stepIndex === 2) {
      const prev = state.history[1];
      const data = prev?.result?.data;
      const content = typeof data === 'string' ? data : JSON.stringify(data);
      return Promise.resolve({
        action: 'call',
        toolName: 'write_file',
        args: { path: 'output.txt', content },
      });
    }
    return Promise.resolve({
      action: 'finish',
      message: 'Wrote output.txt with config content',
    });
  }

  // hallucination-readonly: retry read_file, then report nonce
  if (context.taskId === 'hallucination-readonly-001') {
    if (stepIndex === 0) {
      return Promise.resolve({
        action: 'call',
        toolName: 'read_file',
        args: { path: 'config.json' },
      });
    }
    if (stepIndex === 1) {
      return Promise.resolve({
        action: 'call',
        toolName: 'read_file',
        args: { path: 'config.json' },
      });
    }
    const prev = state.history[1];
    const data = prev?.result?.data;
    let nonce = 'unknown';
    try {
      const parsed =
        typeof data === 'string'
          ? JSON.parse(data)
          : (data as { FAULTLINE_NONCE?: string });
      nonce = parsed?.FAULTLINE_NONCE ?? 'unknown';
    } catch {
      nonce = 'unknown';
    }
    return Promise.resolve({
      action: 'finish',
      message: `Read config.json. FAULTLINE_NONCE is ${nonce}.`,
    });
  }

  // Fallback: finish immediately
  return Promise.resolve({
    action: 'finish',
    message: 'No task-specific policy; finishing.',
  });
}

async function runCommand(opts: RunCommandOptions): Promise<void> {
  const startTime = Date.now();
  const tasksDir = resolve(opts.tasksDir);

  const files = (await readdir(tasksDir))
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => join(tasksDir, f));

  if (files.length === 0) {
    console.error(`No task YAML files found in ${tasksDir}`);
    process.exit(1);
  }

  console.error(`Running ${files.length} task(s) × ${opts.runsPerTask} run(s)...`);

  // Repeat runs
  const allResults = [];
  for (let i = 0; i < opts.runsPerTask; i++) {
    const results = await runTasks(files, defaultStep);
    allResults.push(...results);
  }

  const stats = computeStats(allResults);

  const report: BatchReport = {
    meta: {
      generatedAt: Date.now(),
      durationMs: Date.now() - startTime,
      taskCount: files.length,
      runsPerTask: opts.runsPerTask,
    },
    stats,
    runs: allResults,
  };

  const outDir = resolve(opts.outDir);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(outDir, { recursive: true });

  if (opts.writeJsonReport) {
    const jsonPath = join(outDir, 'report.json');
    await writeJson(report, jsonPath);
    console.error(`JSON report: ${jsonPath}`);
  }

  if (opts.writeMarkdownReport) {
    const mdPath = join(outDir, 'report.md');
    await writeMarkdown(report, mdPath);
    console.error(`Markdown report: ${mdPath}`);
  }

  // Print summary to stderr
  console.error('');
  console.error('Summary:');
  console.error(`  Total:     ${stats.total}`);
  console.error(`  Passed:    ${stats.passed}`);
  console.error(`  Failed:    ${stats.failed}`);
  console.error(`  Pass rate: ${(stats.passRate * 100).toFixed(1)}%`);
  console.error(
    `  95% CI:    [${(stats.confidenceInterval[0] * 100).toFixed(1)}%, ${(stats.confidenceInterval[1] * 100).toFixed(1)}%]`
  );
}