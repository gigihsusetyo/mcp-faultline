// src/task/loader.ts

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TaskSchema, type Task } from './schema.js';

/**
 * Load and validate a task specification from a YAML file.
 *
 * @param filePath - Path to the YAML file (absolute or relative to cwd)
 * @returns Validated Task object
 * @throws Error if file cannot be read or validation fails
 */
export async function loadTask(filePath: string): Promise<Task> {
  const absolutePath = resolve(filePath);

  let rawContent: string;
  try {
    rawContent = await readFile(absolutePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read task file at "${absolutePath}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(rawContent);
  } catch (error) {
    throw new Error(
      `Failed to parse YAML at "${absolutePath}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const result = TaskSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `  - ${path}: ${issue.message}`;
      })
      .join('\n');

    throw new Error(
      `Task validation failed for "${absolutePath}":\n${issues}`
    );
  }

  return result.data;
}

/**
 * Load multiple task specifications from a list of file paths.
 *
 * @param filePaths - Array of paths to YAML files
 * @returns Array of validated Task objects
 */
export async function loadTasks(filePaths: string[]): Promise<Task[]> {
  return Promise.all(filePaths.map((path) => loadTask(path)));
}