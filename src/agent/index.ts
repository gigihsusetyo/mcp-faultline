// src/agent/index.ts

/**
 * Agent module — abstraction for the agent being evaluated.
 *
 * The agent is a BLACK BOX. The framework provides tools,
 * observes calls, and grades the result. It does NOT run
 * the agent's internal loop.
 *
 * Public API:
 * - AgentAdapter — interface for all agents
 * - EmbeddedAgent — MVP in-process agent
 * - Types: AgentContext, AgentTool, AgentRunResult
 */

export * from './types.js';
export * from './embedded.js';