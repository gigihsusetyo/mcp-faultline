// src/task/validator.ts

import { TaskSchema, type Task } from './schema.js';
import type { ZodIssue } from 'zod';

/**
 * Validation result with detailed error information.
 */
export interface ValidationResult {
  valid: boolean;
  task?: Task;
  errors?: string[];
}

/**
 * Validate a raw object against the Task schema.
 *
 * This function does not throw — it returns a result object
 * with detailed error information. Useful for programmatic
 * validation where you want to handle errors gracefully.
 *
 * @param input - Raw object to validate
 * @returns ValidationResult with task or error messages
 */
export function validateTask(input: unknown): ValidationResult {
  const result = TaskSchema.safeParse(input);

  if (result.success) {
    return {
      valid: true,
      task: result.data,
    };
  }

  return {
    valid: false,
    errors: formatIssues(result.error.issues),
  };
}

/**
 * Format Zod issues into human-readable strings.
 */
function formatIssues(issues: ZodIssue[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}