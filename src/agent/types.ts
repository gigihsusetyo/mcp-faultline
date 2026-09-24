// src/agent/types.ts

/**
 * Agent types — abstraction for the agent being evaluated.
 *
 * An agent is treated as a BLACK BOX. The framework does not
 * run the agent's loop — it only provides tools and observes calls.
 *
 * MVP: EmbeddedAgent — simple deterministic agent we control.
 * v0.2: ExternalAgent — Claude Code, Cursor, Cline, etc.
 */

/**
 * A tool available to the agent.
 */
export interface AgentTool {
    /** Tool name as exposed to the agent */
    name: string;
    /** Human-readable description */
    description: string;
    /**
     * Execute the tool with given arguments.
     * Returns result data, or throws on error.
     */
    execute(args: unknown): Promise<unknown>;
  }
  
  /**
   * Context passed to the agent at the start of a run.
   */
  export interface AgentContext {
    /** Task ID being executed */
    taskId: string;
    /** Task goal (natural language) */
    goal: string;
    /** Tools available to the agent */
    tools: AgentTool[];
    /** Forbidden tool names — agent must not call these */
    forbiddenTools: string[];
    /** Maximum number of tool calls allowed */
    maxToolCalls: number;
  }
  
  /**
   * Result of an agent run.
   */
  export interface AgentRunResult {
    /** Final status */
    status: 'completed' | 'failed' | 'aborted' | 'timeout';
    /** Optional error message if status is not 'completed' */
    error?: string;
    /** Optional final message from the agent */
    finalMessage?: string;
  }
  
  /**
   * Agent adapter — interface for any agent implementation.
   *
   * The framework calls `run()` with a context, and the agent
   * executes its loop, calling tools via the provided context.
   *
   * The framework observes all tool calls via the Observer layer.
   */
  export interface AgentAdapter {
    /** Human-readable name of this adapter */
    readonly name: string;
    /**
     * Run the agent until completion, failure, or abort.
     * The agent MUST respect maxToolCalls and forbiddenTools.
     */
    run(context: AgentContext): Promise<AgentRunResult>;
  }