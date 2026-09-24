// src/testing/negative-controls/infinite-loop-agent.ts

import type { NegativeControl } from './types.js';

/**
 * Infinite Loop Agent — calls the same tool with the same args
 * on every step. The loop detector should flag this.
 */
export const infiniteLoopAgent: NegativeControl = {
  name: 'Infinite Loop Agent',
  async step(_state) {
    return {
      action: 'call',
      toolName: 'read_file',
      args: { path: 'config.json' },
    };
  },
};