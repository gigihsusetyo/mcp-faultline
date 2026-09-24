// src/mcp/observer.ts

import type {
    ToolCallRecord,
    ToolCallResult,
    Trajectory,
    TrajectoryEvent,
    EventActor,
  } from './types.js';
  import { randomUUID } from 'node:crypto';
  
  /**
   * Observer interface — intercepts tool calls for recording and fault injection.
   */
  export interface Observer {
    beforeCall(
      toolName: string,
      args: unknown
    ): Promise<BeforeCallResult>;
  
    afterCall(record: ToolCallRecord): Promise<void>;
  
    /**
     * Record a typed event in the trajectory.
     */
    recordEvent(event: Omit<TrajectoryEvent, 'index' | 'timestamp'>): Promise<void>;
  
    finalize(
      status: Trajectory['status'],
      error?: string,
      agentFinalMessage?: string
    ): Promise<Trajectory>;
  }
  
  export type BeforeCallResult =
    | { action: 'proceed'; args: unknown }
    | { action: 'abort'; result: ToolCallResult };
  
  /**
   * TrajectoryRecorder — observes and records all tool calls and events.
   */
  export class TrajectoryRecorder implements Observer {
    readonly runId: string;
    readonly taskId: string;
    private readonly startedAt: number;
    private readonly calls: ToolCallRecord[] = [];
    private readonly events: TrajectoryEvent[] = [];
    private finalized = false;
  
    constructor(taskId: string) {
      this.runId = randomUUID();
      this.taskId = taskId;
      this.startedAt = Date.now();
    }
  
    async beforeCall(toolName: string, args: unknown): Promise<BeforeCallResult> {
      return { action: 'proceed', args };
    }
  
    async afterCall(record: ToolCallRecord): Promise<void> {
      if (this.finalized) {
        throw new Error(
          `Cannot record call after trajectory was finalized (runId=${this.runId})`
        );
      }
      this.calls.push(record);
    }
  
    async recordEvent(
      event: Omit<TrajectoryEvent, 'index' | 'timestamp'>
    ): Promise<void> {
      if (this.finalized) {
        throw new Error(
          `Cannot record event after trajectory was finalized (runId=${this.runId})`
        );
      }
      this.events.push({
        ...event,
        index: this.events.length,
        timestamp: Date.now(),
      });
    }
  
    async finalize(
      status: Trajectory['status'],
      error?: string,
      agentFinalMessage?: string
    ): Promise<Trajectory> {
      this.finalized = true;
      return {
        runId: this.runId,
        taskId: this.taskId,
        startedAt: this.startedAt,
        endedAt: Date.now(),
        calls: [...this.calls],
        events: [...this.events],
        status,
        error,
        agentFinalMessage,
      };
    }
  
    getCalls(): readonly ToolCallRecord[] {
      return this.calls;
    }
  
    getEvents(): readonly TrajectoryEvent[] {
      return this.events;
    }
  
    get callCount(): number {
      return this.calls.length;
    }
  }