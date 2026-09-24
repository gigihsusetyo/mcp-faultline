// src/agent/embedded.ts

import type {
    AgentAdapter,
    AgentContext,
    AgentRunResult,
    AgentTool,
  } from './types.js';
  
  /**
   * A step function that decides what the agent should do next.
   */
  export type AgentStep = (state: AgentStepState) => Promise<AgentStepResult>;
  
  export interface AgentStepState {
    context: AgentContext;
    history: AgentHistoryEntry[];
    stepIndex: number;
  }
  
  export interface AgentHistoryEntry {
    toolName: string;
    args: unknown;
    result: { status: string; data?: unknown; message?: string };
  }
  
  export type AgentStepResult =
    | { action: 'call'; toolName: string; args: unknown }
    | { action: 'finish'; message: string }
    | { action: 'abort'; reason: string };
  
  /**
   * EmbeddedAgent — a simple agent that runs in-process.
   *
   * NOTE: the agent no longer checks for forbidden tools. It simply
   * asks the tool to execute; the tool wrapper is responsible for
   * enforcing policy. This is intentional: the agent's *attempt* must
   * be observable to the grader.
   */
  export class EmbeddedAgent implements AgentAdapter {
    readonly name = 'EmbeddedAgent';
    private readonly step: AgentStep;
  
    constructor(step: AgentStep) {
      this.step = step;
    }
  
    async run(context: AgentContext): Promise<AgentRunResult> {
      const history: AgentHistoryEntry[] = [];
      const toolsByName = new Map<string, AgentTool>();
      for (const tool of context.tools) {
        toolsByName.set(tool.name, tool);
      }
  
      for (let stepIndex = 0; stepIndex < context.maxToolCalls; stepIndex++) {
        let decision: AgentStepResult;
        try {
          decision = await this.step({ context, history, stepIndex });
        } catch (error) {
          return {
            status: 'failed',
            error: `Agent step threw: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
  
        if (decision.action === 'finish') {
          return { status: 'completed', finalMessage: decision.message };
        }
  
        if (decision.action === 'abort') {
          return { status: 'aborted', error: decision.reason };
        }
  
        // decision.action === 'call'
        const { toolName, args } = decision;
  
        // No policy check here. The tool wrapper enforces policy.
        const tool = toolsByName.get(toolName);
  
        if (!tool) {
          history.push({
            toolName,
            args,
            result: { status: 'error', message: `Unknown tool "${toolName}"` },
          });
          continue;
        }
  
        try {
          const data = await tool.execute(args);
          history.push({ toolName, args, result: { status: 'success', data } });
        } catch (error) {
          history.push({
            toolName,
            args,
            result: {
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
  
      return {
        status: 'timeout',
        error: `Agent exceeded maxToolCalls (${context.maxToolCalls})`,
      };
    }
  }