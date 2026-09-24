// src/report/json.ts

import { readFile, writeFile } from 'node:fs/promises';
import type { BatchReport } from './types.js';

/**
 * JSON report — machine-readable output.
 *
 * Use this for CI integration and downstream tooling.
 */
export function toJson(report: BatchReport, pretty = true): string {
  return JSON.stringify(report, null, pretty ? 2 : 0);
}

/**
 * Write a BatchReport to a file as JSON.
 */
export async function writeJson(
  report: BatchReport,
  filePath: string,
  pretty = true
): Promise<void> {
  await writeFile(filePath, toJson(report, pretty), 'utf-8');
}

/**
 * Read a JSON file and parse it as type T.
 *
 * Generic on purpose — the caller knows what shape it expects.
 * Used by the replay command to load a RunResult (or a BatchReport
 * containing one) from disk.
 *
 * Throws if the file cannot be read or is not valid JSON.
 */
export async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}