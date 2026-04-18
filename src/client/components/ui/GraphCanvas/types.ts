import type { ModelKey, Phase, StopReason } from '../../../lib/types';

export interface TurnNodeData extends Record<string, unknown> {
  kind: 'turn';
  turnId: string;
  label: string;
  modelKey: ModelKey;
  phase: Phase;
  isSidechain: boolean;
  tools: string[];
  stopReason: StopReason | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitPct: number;
  costUsd: number;
  // v7 enrichment
  durationMs?: number | null;
  isApiError?: boolean;
  apiErrorStatus?: string | null;
  hasThinking?: boolean;
  iterationsCount?: number;
  webSearchCount?: number;
  webFetchCount?: number;
  hooksCount?: number;
  filesChangedCount?: number;
  permissionMode?: string | null;
  slug?: string | null;
  requestId?: string | null;
}

export interface ClusterNodeData extends Record<string, unknown> {
  kind: 'cluster';
  clusterId: string;
  label: string;                // "Exploration ×8"
  modelKey: ModelKey;
  phase: Phase;
  tools: string[];              // shared toolset signature
  turnCount: number;
  totalTokens: number;
  totalCost: number;
  avgCacheHitPct: number;
  firstTurnIdx: number;
  lastTurnIdx: number;
}

export type GraphNodeData = TurnNodeData | ClusterNodeData;
