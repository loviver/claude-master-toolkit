/**
 * Domain types mirroring the SQLite schema + API responses.
 * Single source of truth for the client.
 */

export type {
  ModelKey,
  Phase,
  StopReason,
  SessionGraphNodeDTO,
  SessionGraphEdgeDTO,
  SessionGraphDTO,
  TurnContentDTO,
  TurnPairDTO,
  TurnToolCall,
} from '../../shared/api-types';
import type {
  ModelKey,
  Phase,
  StopReason,
} from '../../shared/api-types';

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface SessionSummary {
  id: string;
  projectPath: string;
  startedAt: number;
  lastActiveAt: number;
  primaryModel: string;
  primaryModelKey: ModelKey;
  gitBranch?: string | null;
  turnCount: number;
  sidechainTurns: number;
  toolCount: number;
  dominantPhase: Phase;
  models: Array<{ model: string; modelKey: ModelKey; turns: number; costUsd: number }>;
  tokens: TokenTotals;
  costUsd: number;
}

export interface TokenEvent {
  id: number;
  sessionId: string;
  timestamp: number;
  model: string;
  modelKey: ModelKey;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  toolsUsed: string[];
  stopReason?: StopReason | null;
  isSidechain: boolean;
  parentUuid?: string | null;
  semanticPhase?: Phase;
}

export interface ModelBreakdownEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  turns: number;
}

export interface SessionDetail extends SessionSummary {
  version?: string | null;
  events: TokenEvent[];
  modelBreakdown: Record<string, ModelBreakdownEntry>;
}

export interface GitStats {
  insertions: number;
  deletions: number;
  filesChanged: number;
  available: boolean;
}

export interface TimelinePoint {
  date: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  sessions: number;
}

export interface ModelStats {
  model: string;
  modelKey: ModelKey;
  totalTokens: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  costUsd: number;
  turns: number;
  sessionCount: number;
  percentage: number; // 0-100
}

export interface ToolEfficiency {
  perTool: Record<string, {
    count: number;
    avgInputTokens: number;
    avgOutputTokens: number;
    avgCostUsd: number;
  }>;
  overall: {
    avgTokensPerTurn: number;
    avgCostPerTurn: number;
  };
}

export interface PhaseBreakdown {
  [phase: string]: {
    turns: number;
    pct: number;
    tokens: number;
  };
}

export interface ToolStats {
  frequency: Record<string, number>;
  combos: Array<{ tools: string[]; count: number }>;
}

export interface EfficiencyScore {
  sessionId: string;
  score: number;
  breakdown: {
    tokensPerTurn: number;
    cacheHitRatio: number;
    errorRecovery: number;
    phaseBalance: number;
  };
}

export interface CurrentStats {
  latestSession: {
    id: string;
    projectPath: string;
    primaryModel: string;
    primaryModelKey: ModelKey;
    costUsd: number;
    turnCount: number;
    lastActiveAt: number;
  } | null;
  totalSessions: number;
  totalCostUsd: number;
  totalTurns: number;
  avgCostPerSession: number;
  activeProjects: number;
}

export interface DashboardBundle {
  current: CurrentStats;
  timeline: TimelinePoint[];
  models: ModelStats[];
  phases: PhaseBreakdown;
  tools: ToolStats;
  efficiency: EfficiencyScore;
  projects: ProjectStats[];
}

export interface ProjectStats {
  projectPath: string;
  projectName: string;
  sessionCount: number;
  turnCount: number;
  costUsd: number;
  lastActiveAt: number;
  dominantModel: ModelKey;
}

// Legacy aliases — prefer the DTO names directly.
export type { SessionGraphNodeDTO as SessionGraphNode, SessionGraphDTO as SessionGraph } from '../../shared/api-types';

export interface Memory {
  id: string;
  title: string;
  type: string;
  scope: string;
  topicKey?: string;
  description?: string;
  content: string;
  projectPath?: string;
  filePath?: string;
  sessionId?: string;
  accessCount: number;
  lastAccessedAt?: number;
  createdAt: number;
  updatedAt: number;
}
