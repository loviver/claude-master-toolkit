import {
  type PlanDefinition,
  type PlanExecutionState,
  type PlanNode,
  type PlanNodeState,
} from '../types/plan.js';
import {
  buildAgentPromptPreamble,
  NullAgentBridge,
  type AgentBridge,
} from './agent-bridge.js';

export interface ExecutorContext {
  onProgress?: (msg: string) => void;
  onError?: (nodeId: string, err: Error) => void;
  getOutput?: (nodeId: string) => unknown;
  /**
   * Optional live-definition fetcher. When provided, executor re-reads
   * the plan definition before following edges — lets `wf_mutate` inject
   * nodes mid-flight.
   */
  getLiveDefinition?: () => PlanDefinition;
  agentBridge?: AgentBridge;
}

export class PlanExecutor {
  private definition: PlanDefinition;
  private state: PlanExecutionState;
  private ctx: ExecutorContext;
  private planId: string;
  private bridge: AgentBridge;

  constructor(
    planId: string,
    definition: PlanDefinition,
    ctx: ExecutorContext = {}
  ) {
    this.planId = planId;
    this.definition = definition;
    this.ctx = ctx;
    this.bridge = ctx.agentBridge ?? new NullAgentBridge();
    this.state = {
      id: `exec-${Date.now()}`,
      planId,
      state: 'running',
      nodeStates: new Map(),
      startedAt: Date.now(),
      timeline: [],
    };

    for (const node of definition.nodes) {
      this.state.nodeStates.set(node.id, {
        nodeId: node.id,
        status: 'pending',
        attempts: 0,
      });
    }
  }

  /** Override execution id — used by orchestrators that create the id upfront. */
  setExecutionId(id: string): void {
    this.state.id = id;
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

  private _currentDef(): PlanDefinition {
    if (!this.ctx.getLiveDefinition) return this.definition;
    try {
      const live = this.ctx.getLiveDefinition();
      this.definition = live;
      // Ensure node states exist for newly injected nodes
      for (const n of live.nodes) {
        if (!this.state.nodeStates.has(n.id)) {
          this.state.nodeStates.set(n.id, { nodeId: n.id, status: 'pending', attempts: 0 });
        }
      }
      return live;
    } catch {
      return this.definition;
    }
  }

  private async _traverseFrom(nodeId: string): Promise<void> {
    const def = this._currentDef();
    const node = def.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    let nodeState = this.state.nodeStates.get(nodeId);
    if (!nodeState) {
      nodeState = { nodeId, status: 'pending', attempts: 0 } as PlanNodeState;
      this.state.nodeStates.set(nodeId, nodeState);
    }

    // Skip if already done (happens when a removed/skipped node gets rewired)
    if (nodeState.status === 'done') return;

    nodeState.status = 'running';
    nodeState.startedAt = Date.now();
    this.state.currentNodeId = nodeId;
    this._emitTimeline(nodeId, 'running');

    try {
      await this._executeNode(node);

      nodeState.status = 'done';
      nodeState.completedAt = Date.now();
      this._emitTimeline(nodeId, 'done');
      this.ctx.onProgress?.(`✓ ${node.label}`);

      // Re-read definition so agent-driven mutations take effect
      const liveDef = this._currentDef();
      const liveNode = liveDef.nodes.find((n) => n.id === nodeId) ?? node;
      const nextEdges = liveNode.edges.filter((e) => !e.condition || e.condition === 'success');
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

      if (nodeState.attempts <= (node.retries || 0)) {
        this.ctx.onProgress?.(`  Retrying (${nodeState.attempts}/${node.retries})...`);
        await this._traverseFrom(nodeId);
      } else {
        throw err;
      }
    }
  }

  private async _executeNode(node: PlanNode): Promise<void> {
    switch (node.type) {
      case 'task':
        return this._executeTask(node);
      case 'agent':
        return this._executeAgent(node);
      case 'decision':
        return this._executeDecision(node);
      case 'bash':
        return this._executeBash(node);
      case 'skill':
        return this._executeSkill(node);
      case 'read':
        return this._executeRead(node);
      case 'edit':
        return this._executeEdit(node);
      case 'subflow':
        return this._executeSubflow(node);
      case 'parallel':
        return this._executeParallel(node);
      default: {
        const _exhaustive: never = node.type;
        throw new Error(`Unknown node type: ${_exhaustive}`);
      }
    }
  }

  private async _executeTask(node: PlanNode): Promise<void> {
    const config = node.config as { command?: string };
    this.ctx.onProgress?.(`  Task: ${config.command ?? node.label}`);
    const s = this.state.nodeStates.get(node.id)!;
    s.output = { command: config.command, status: 'executed' };
  }

  private async _executeAgent(node: PlanNode): Promise<void> {
    const config = node.config as {
      subagent_type?: string;
      prompt?: string;
      agentPrompt?: string;
      agentRole?: string;
      model?: 'opus' | 'sonnet' | 'haiku' | 'inherit';
      toolWhitelist?: string[];
      run_in_background?: boolean;
    };
    const prompt = config.prompt ?? config.agentPrompt;
    if (!prompt) throw new Error(`Agent ${node.id} missing 'prompt' config`);

    const inv = {
      subagent_type: config.subagent_type ?? config.agentRole,
      prompt,
      model: config.model,
      toolWhitelist: config.toolWhitelist,
      run_in_background: config.run_in_background,
      execution_id: this.state.id,
      plan_id: this.planId,
      current_node_id: node.id,
    };

    this.ctx.onProgress?.(`  Agent: ${inv.subagent_type ?? 'default'}`);
    const result = await this.bridge.invoke({
      ...inv,
      prompt: buildAgentPromptPreamble(inv),
    });
    const s = this.state.nodeStates.get(node.id)!;
    s.output = result.output;
    if (result.error) throw new Error(result.error);
  }

  private async _executeDecision(node: PlanNode): Promise<void> {
    this.ctx.onProgress?.(`  Decision: ${node.label}`);
    const s = this.state.nodeStates.get(node.id)!;
    s.output = { decision: 'pending_user_input' };
  }

  private async _executeBash(node: PlanNode): Promise<void> {
    const config = node.config as { command?: string };
    if (!config.command) throw new Error(`Bash ${node.id} missing 'command' config`);
    // Real shell spawning deferred — bridge pattern like agent bridge. For now log.
    this.ctx.onProgress?.(`  Bash: ${config.command}`);
    const s = this.state.nodeStates.get(node.id)!;
    s.output = { command: config.command, status: 'queued' };
  }

  private async _executeSkill(node: PlanNode): Promise<void> {
    const config = node.config as { skill?: string; args?: string };
    if (!config.skill) throw new Error(`Skill ${node.id} missing 'skill' config`);
    this.ctx.onProgress?.(`  Skill: ${config.skill}`);
    const s = this.state.nodeStates.get(node.id)!;
    s.output = { skill: config.skill, args: config.args, status: 'queued' };
  }

  private async _executeRead(node: PlanNode): Promise<void> {
    const config = node.config as { file_path?: string };
    if (!config.file_path) throw new Error(`Read ${node.id} missing 'file_path' config`);
    this.ctx.onProgress?.(`  Read: ${config.file_path}`);
    const s = this.state.nodeStates.get(node.id)!;
    s.output = { file_path: config.file_path, status: 'queued' };
  }

  private async _executeEdit(node: PlanNode): Promise<void> {
    const config = node.config as { file_path?: string };
    if (!config.file_path) throw new Error(`Edit ${node.id} missing 'file_path' config`);
    this.ctx.onProgress?.(`  Edit: ${config.file_path}`);
    const s = this.state.nodeStates.get(node.id)!;
    s.output = { file_path: config.file_path, status: 'queued' };
  }

  private async _executeSubflow(node: PlanNode): Promise<void> {
    const config = node.config as { plan_id?: string };
    if (!config.plan_id) throw new Error(`Subflow ${node.id} missing 'plan_id' config`);
    this.ctx.onProgress?.(`  Subflow: ${config.plan_id}`);
    const s = this.state.nodeStates.get(node.id)!;
    s.output = { plan_id: config.plan_id, status: 'queued' };
  }

  private async _executeParallel(node: PlanNode): Promise<void> {
    const config = node.config as { nodes?: string[]; joinStrategy?: string };
    this.ctx.onProgress?.(`  Parallel: ${config.nodes?.length ?? 0} branches`);
    const s = this.state.nodeStates.get(node.id)!;
    s.output = { nodes: config.nodes, joinStrategy: config.joinStrategy };
  }

  private _emitTimeline(nodeId: string, status: string): void {
    this.state.timeline.push({ nodeId, at: Date.now(), status });
  }

  getState(): PlanExecutionState {
    return this.state;
  }
}
