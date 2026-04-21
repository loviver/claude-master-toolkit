import { type PlanExecutionState, type PlanNodeState, type PlanDefinition, type PlanNode } from '../types/plan.js';

export interface ExecutorContext {
  onProgress?: (msg: string) => void;
  onError?: (nodeId: string, err: Error) => void;
  getOutput?: (nodeId: string) => unknown;
}

export class PlanExecutor {
  private definition: PlanDefinition;
  private state: PlanExecutionState;
  private ctx: ExecutorContext;

  constructor(
    planId: string,
    definition: PlanDefinition,
    ctx: ExecutorContext = {}
  ) {
    this.definition = definition;
    this.ctx = ctx;
    this.state = {
      id: `exec-${Date.now()}`,
      planId,
      state: 'running',
      nodeStates: new Map(),
      startedAt: Date.now(),
      timeline: [],
    };

    // Initialize all nodes
    for (const node of definition.nodes) {
      this.state.nodeStates.set(node.id, {
        nodeId: node.id,
        status: 'pending',
        attempts: 0,
      });
    }
  }

  async execute(): Promise<PlanExecutionState> {
    try {
      await this._traverseFrom(this.definition.entrypoint);
      this.state.state = 'completed';
      this.state.completedAt = Date.now();
    } catch (err) {
      this.state.state = 'failed';
      this.state.error = (err as Error).message;
      this.state.completedAt = Date.now();
      this.ctx.onError?.(this.state.currentNodeId || 'unknown', err as Error);
    }
    return this.state;
  }

  private async _traverseFrom(nodeId: string): Promise<void> {
    const node = this.definition.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const nodeState = this.state.nodeStates.get(nodeId)!;
    nodeState.status = 'running';
    nodeState.startedAt = Date.now();
    this.state.currentNodeId = nodeId;
    this._emitTimeline(nodeId, 'running');

    try {
      // Execute node based on type
      switch (node.type) {
        case 'task':
          await this._executeTask(node);
          break;
        case 'agent':
          await this._executeAgent(node);
          break;
        case 'decision':
          await this._executeDecision(node);
          break;
      }

      nodeState.status = 'done';
      nodeState.completedAt = Date.now();
      this._emitTimeline(nodeId, 'done');
      this.ctx.onProgress?.(`✓ ${node.label}`);

      // Follow edges
      const nextEdges = node.edges.filter((e) => !e.condition || e.condition === 'success');
      for (const edge of nextEdges) {
        await this._traverseFrom(edge.target);
      }
    } catch (err) {
      nodeState.status = 'failed';
      nodeState.error = (err as Error).message;
      nodeState.completedAt = Date.now();
      nodeState.attempts += 1;
      this._emitTimeline(nodeId, 'failed');
      this.ctx.onProgress?.(`✗ ${node.label}: ${(err as Error).message}`);

      // Check retries
      if (nodeState.attempts <= (node.retries || 0)) {
        this.ctx.onProgress?.(`  Retrying (${nodeState.attempts}/${node.retries})...`);
        await this._traverseFrom(nodeId);
      } else {
        throw err;
      }
    }
  }

  private async _executeTask(node: PlanNode): Promise<void> {
    const config = node.config as { command?: string };
    if (!config.command) {
      throw new Error(`Task ${node.id} missing 'command' config`);
    }

    // For now: just log. Real impl would spawn shell
    this.ctx.onProgress?.(`  Running: ${config.command}`);
    const nodeState = this.state.nodeStates.get(node.id)!;
    nodeState.output = { command: config.command, status: 'executed' };
  }

  private async _executeAgent(node: PlanNode): Promise<void> {
    const config = node.config as { agentPrompt?: string; agentRole?: string };
    if (!config.agentPrompt) {
      throw new Error(`Agent ${node.id} missing 'agentPrompt' config`);
    }

    // For now: just log. Real impl would call Agent tool via bridge
    this.ctx.onProgress?.(`  Launching agent: ${config.agentRole || 'default'}`);
    const nodeState = this.state.nodeStates.get(node.id)!;
    nodeState.output = {
      agentPrompt: config.agentPrompt,
      agentRole: config.agentRole,
      status: 'queued',
    };
  }

  private async _executeDecision(node: PlanNode): Promise<void> {
    // Decisions would need LLM call or user input
    this.ctx.onProgress?.(`  Decision: ${node.label}`);
    const nodeState = this.state.nodeStates.get(node.id)!;
    nodeState.output = { decision: 'pending_user_input' };
  }

  private _emitTimeline(nodeId: string, status: string): void {
    this.state.timeline.push({
      nodeId,
      at: Date.now(),
      status,
    });
  }

  getState(): PlanExecutionState {
    return this.state;
  }
}
