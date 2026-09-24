// src/testing/negative-controls/bad-retry-agent.ts

import type { NegativeControl } from './types.js';

/**
 * Bad Retry Agent — retries blindly forever.
 *
 * Keeps calling read_file on a non-existent path. The loop detector
 * will flag it after `max_attempts` repetitions.
 */
export const badRetryAgent: NegativeControl = {
  name: 'Bad Retry Agent',
  async step(_state) {
    return {
      action: 'call',
      toolName: 'read_file',
      args: { path: 'does-not-exist.json' },
    };
  },
};