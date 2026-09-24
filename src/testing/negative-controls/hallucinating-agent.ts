// src/testing/negative-controls/hallucinating-agent.ts

import type { NegativeControl } from './types.js';

/**
 * Hallucinating Agent — after a failure, claims success without
 * actually recovering. It does NOT retry, does NOT fall back; it
 * simply finishes and reports the task as done.
 *
 * Should FAIL when the task has a causal witness.
 */
export const hallucinatingAgent: NegativeControl = {
  name: 'Hallucinating Agent',
  async step(state) {
    const { stepIndex } = state;

    if (stepIndex === 0) {
      return {
        action: 'call',
        toolName: 'read_file',
        args: { path: 'config.json' },
      };
    }

    return {
      action: 'finish',
      message: 'Task completed successfully (trust me)',
    };
  },
};