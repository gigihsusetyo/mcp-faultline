// src/report/markdown.ts

import { writeFile } from 'node:fs/promises';
import type { BatchReport } from './types.js';
import { formatPercent, formatCI } from './stats.js';

/**
 * Markdown report — human-readable output.
 *
 * Use this for README badges, CI summaries, and dev logs.
 */
export function toMarkdown(report: BatchReport): string {
  const { meta, stats, runs } = report;
  const lines: string[] = [];

  lines.push('# MCP-Faultline Report');
  lines.push('');
  lines.push(`**Generated:** ${new Date(meta.generatedAt).toISOString()}`);
  lines.push(`**Duration:** ${(meta.durationMs / 1000).toFixed(2)}s`);
  lines.push(`**Tasks:** ${meta.taskCount}`);
  lines.push(`**Runs per task:** ${meta.runsPerTask}`);
  lines.push('');

  // ─── Overall (run-level) ───
  lines.push('## Overall');
  lines.push('');
  lines.push('_Unit = run._');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Total runs | ${stats.total} |`);
  lines.push(`| Passed | ${stats.passed} |`);
  lines.push(`| Failed | ${stats.failed} |`);
  lines.push(`| Pass rate | ${formatPercent(stats.passRate)} |`);
  lines.push(`| 95% CI | ${formatCI(stats.confidenceInterval)} |`);
  lines.push(`| Std Dev | ${stats.stdDev.toFixed(4)} |`);
  lines.push('');

  // ─── Task-level statistics ───
  lines.push('## Task-Level Statistics');
  lines.push('');
  lines.push('_Unit = task, not run. Macro average._');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Task scenarios | ${stats.taskLevel.scenarios} |`);
  lines.push(`| Tasks passed | ${stats.taskLevel.passed} |`);
  lines.push(`| Tasks failed | ${stats.taskLevel.failed} |`);
  lines.push(`| Macro pass rate | ${formatPercent(stats.taskLevel.macroPassRate)} |`);
  lines.push('');

  // ─── Data quality ───
  lines.push('## Data Quality');
  lines.push('');
  lines.push('_Sample characteristics — interpret with context._');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Task scenarios | ${stats.dataQuality.taskScenarios} |`);
  lines.push(`| Executions | ${stats.dataQuality.executions} |`);
  lines.push(`| Runs per task | ${stats.dataQuality.runsPerTask} |`);
  lines.push('');

  if (stats.dataQuality.warnings.length > 0) {
    for (const warning of stats.dataQuality.warnings) {
      lines.push(`⚠️ ${warning}`);
      lines.push('');
    }
  }

  // ─── Per-task breakdown ───
  lines.push('## Per-Task Breakdown');
  lines.push('');
  lines.push('| Task | Passed | Total | Rate |');
  lines.push('|---|---|---|---|');
  for (const [taskId, t] of Object.entries(stats.byTask)) {
    lines.push(
      `| ${taskId} | ${t.passed} | ${t.total} | ${formatPercent(t.rate)} |`
    );
  }
  lines.push('');

  // ─── Failure distribution ───
  if (Object.keys(stats.failureDistribution).length > 0) {
    lines.push('## Failure Distribution');
    lines.push('');
    lines.push('| Reason | Count |');
    lines.push('|---|---|');
    for (const [reason, count] of Object.entries(stats.failureDistribution)) {
      lines.push(`| ${reason} | ${count} |`);
    }
    lines.push('');
  }

  // ─── Recovery distribution (2 dimensions) ───
  const recoveryStrategies: Record<string, number> = {};
  const recoveryOutcomes: Record<string, number> = {};
  for (const run of runs) {
    const r = run.grade.recovery;
    if (r) {
      recoveryStrategies[r.strategy] = (recoveryStrategies[r.strategy] ?? 0) + 1;
      recoveryOutcomes[r.outcome] = (recoveryOutcomes[r.outcome] ?? 0) + 1;
    }
  }

  if (Object.keys(recoveryStrategies).length > 0) {
    lines.push('## Recovery Classification');
    lines.push('');
    lines.push('### Strategy (what the agent did)');
    lines.push('');
    lines.push('| Strategy | Count |');
    lines.push('|---|---|');
    for (const [strategy, count] of Object.entries(recoveryStrategies)) {
      lines.push(`| ${strategy} | ${count} |`);
    }
    lines.push('');
    lines.push('### Outcome (whether recovery succeeded)');
    lines.push('');
    lines.push('| Outcome | Count |');
    lines.push('|---|---|');
    for (const [outcome, count] of Object.entries(recoveryOutcomes)) {
      lines.push(`| ${outcome} | ${count} |`);
    }
    lines.push('');
  }

  // ─── Efficiency (aggregate) ───
  const effTotals = {
    toolCalls: 0,
    retries: 0,
    fallbackDepth: 0,
    duplicateActions: 0,
    durationMs: 0,
  };
  for (const run of runs) {
    effTotals.toolCalls += run.grade.efficiency.toolCalls;
    effTotals.retries += run.grade.efficiency.retries;
    effTotals.fallbackDepth += run.grade.efficiency.fallbackDepth;
    effTotals.duplicateActions += run.grade.efficiency.duplicateActions;
    effTotals.durationMs += run.grade.efficiency.durationMs;
  }

  lines.push('## Efficiency');
  lines.push('');
  lines.push('_Informational — does not affect pass/fail._');
  lines.push('');
  lines.push('| Metric | Total |');
  lines.push('|---|---|');
  lines.push(`| Tool calls | ${effTotals.toolCalls} |`);
  lines.push(`| Retries | ${effTotals.retries} |`);
  lines.push(`| Fallback depth | ${effTotals.fallbackDepth} |`);
  lines.push(`| Duplicate actions | ${effTotals.duplicateActions} |`);
  lines.push(`| Duration (sum) | ${effTotals.durationMs}ms |`);
  lines.push('');

  // ─── Individual runs (collapsed) ───
  lines.push('## Run Details');
  lines.push('');
  for (const run of runs) {
    const status = run.grade.passed ? '✅' : '❌';
    lines.push(`<details>`);
    lines.push(
      `<summary>${status} ${run.taskId} — ${run.taskName} (runId: ${run.runId.slice(0, 8)})</summary>`
    );
    lines.push('');
    lines.push(`- Status: ${run.trajectory.status}`);
    lines.push(`- Duration: ${run.durationMs}ms`);
    lines.push(`- Tool calls: ${run.trajectory.calls.length}`);
    lines.push(`- Grade: ${run.grade.summary}`);

    if (run.grade.recovery) {
      const r = run.grade.recovery;
      lines.push(
        `- Recovery: **${r.strategy}** → **${r.outcome}** (confidence: ${r.confidence})`
      );
      if (r.reasoning) {
        lines.push(`  - ${r.reasoning}`);
      }
    }

    // Efficiency per run — one line
    const e = run.grade.efficiency;
    lines.push(
      `- Efficiency: ${e.toolCalls} calls, ${e.retries} retries, ${e.fallbackDepth} fallbacks, ${e.duplicateActions} duplicates, ${e.durationMs}ms`
    );

    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Write markdown report to a file.
 */
export async function writeMarkdown(
  report: BatchReport,
  filePath: string
): Promise<void> {
  await writeFile(filePath, toMarkdown(report), 'utf-8');
}