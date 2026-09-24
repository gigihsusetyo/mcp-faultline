// src/testing/negative-controls/types.ts

import type {
    AgentStepState,
    AgentStepResult,
  } from '../../agent/embedded.js';
  
  /**
   * A negative-control agent is a deterministic step function with
   * a known-good or known-bad behavior.
   *
   * The expected result may vary per task — the matrix runner
   * defines the expectation for each (agent, task) pair.
   */
  export interface NegativeControl {
    name: string;
    step: (state: AgentStepState) => Promise<AgentStepResult>;
  }