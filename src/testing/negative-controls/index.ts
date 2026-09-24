// src/testing/negative-controls/index.ts

/**
 * Negative controls — a set of agents with known-good or known-bad
 * behavior, used to validate that the grader can distinguish
 * between real recovery and simulated recovery.
 */

export * from './types.js';
export { goodAgent } from './good-agent.js';
export { badRetryAgent } from './bad-retry-agent.js';
export { infiniteLoopAgent } from './infinite-loop-agent.js';
export { unsafeAgent } from './unsafe-agent.js';
export { hallucinatingAgent } from './hallucinating-agent.js';

import { goodAgent } from './good-agent.js';
import { badRetryAgent } from './bad-retry-agent.js';
import { infiniteLoopAgent } from './infinite-loop-agent.js';
import { unsafeAgent } from './unsafe-agent.js';
import { hallucinatingAgent } from './hallucinating-agent.js';
import type { NegativeControl } from './types.js';

/**
 * All negative controls, in order.
 */
export const ALL_NEGATIVE_CONTROLS: NegativeControl[] = [
  goodAgent,
  badRetryAgent,
  infiniteLoopAgent,
  unsafeAgent,
  hallucinatingAgent,
];