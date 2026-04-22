// Claude Code API primitives exposed as workflow node types.
// `task` / `decision` / `agent` predate the taxonomy and stay for backward compat.
export type PlanNodeType =
  | 'task'
  | 'decision'
  | 'agent'
  | 'skill'
  | 'bash'
  | 'read'
  | 'edit'
  | 'subflow'
  | 'parallel';

export interface PlanNodeEdge {
  target: string;
  condition?: string; // for decisions: "success" | "failure" | always assumed on task/agent
}

export interface PlanNode {
  id: string;
  type: PlanNodeType;
  label: string;
  description?: string;
  config: Record<string, unknown>; // node-type-specific config (see *NodeConfig below)
  edges: PlanNodeEdge[];
  retries?: number;
  timeout?: number; // ms
}

export interface PlanDefinition {
  nodes: PlanNode[];
  entrypoint: string;
}

export interface Plan {
  id: string;
  name: string;
  description?: string;
  definition: PlanDefinition;
  version: number;
  createdAt: number;
  updatedAt: number;
  projectPath?: string;
}

export interface PlanNodeState {
  nodeId: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  output?: unknown;
  error?: string;
  attempts: number;
  startedAt?: number;
  completedAt?: number;
}

export interface PlanExecutionState {
  id: string;
  planId: string;
  state: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  currentNodeId?: string;
  nodeStates: Map<string, PlanNodeState>;
  output?: unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
  timeline: Array<{ nodeId: string; at: number; status: string }>;
  mutationLog?: MutationLogEntry[];
}

// ── Per-primitive config shapes ──

export interface TaskNodeConfig {
  command?: string;
  script?: string;
  agentPrompt?: string; // legacy agent config — kept for back-compat
  agentRole?: string;
}

export interface DecisionNodeConfig {
  prompt: string;
  options: Array<{ value: string; label: string }>;
}

export interface AgentNodeConfig {
  subagent_type?: string; // e.g. "Explore", "Plan", "general-purpose"
  prompt: string;
  model?: 'opus' | 'sonnet' | 'haiku' | 'inherit';
  toolWhitelist?: string[];
  run_in_background?: boolean;
}

export interface SkillNodeConfig {
  skill: string;
  args?: string;
}

export interface BashNodeConfig {
  command: string;
  timeout?: number;
  run_in_background?: boolean;
}

export interface ReadNodeConfig {
  file_path: string;
  offset?: number;
  limit?: number;
}

export interface EditNodeConfig {
  file_path: string;
  old_string?: string;
  new_string?: string;
  mode?: 'edit' | 'write';
}

export interface SubflowNodeConfig {
  plan_id: string;
  inputMap?: Record<string, string>;
}

export interface ParallelNodeConfig {
  nodes: string[]; // ids of child nodes to run in parallel
  joinStrategy?: 'all' | 'any' | 'race';
}

// ── Mutation log ──

export type MutationOp =
  | { op: 'addNode'; after: string; node: PlanNode }
  | { op: 'updateNode'; id: string; patch: Partial<PlanNode> }
  | { op: 'redirectEdge'; from: string; to: string; newTarget: string }
  | { op: 'removeNode'; id: string; mode: 'skip' | 'prune' }
  | {
      op: 'addBranch';
      from: string;
      condition: string;
      truePath: string;
      falsePath: string;
    };

export interface MutationLogEntry {
  at: number;
  byNodeId?: string; // node that requested the mutation
  op: MutationOp;
}
