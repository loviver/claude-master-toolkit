export type PlanNodeType = 'task' | 'decision' | 'agent';

export interface PlanNodeEdge {
  target: string;
  condition?: string; // for decisions: "success" | "failure" | always assumed on task/agent
}

export interface PlanNode {
  id: string;
  type: PlanNodeType;
  label: string;
  description?: string;
  config: Record<string, unknown>; // task-specific config
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
}

// For task/agent nodes
export interface TaskNodeConfig {
  command?: string; // shell command for task
  script?: string;
  agentPrompt?: string; // for agent type
  agentRole?: string; // explorer|implementer|reviewer|orchestrator
}

export interface DecisionNodeConfig {
  prompt: string; // decision prompt for LLM
  options: Array<{ value: string; label: string }>;
}
