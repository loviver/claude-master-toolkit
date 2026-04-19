import type { TokenUsage } from './base.js';

// ── Semantic phase classification ──

export type SemanticPhase = 'exploration' | 'implementation' | 'testing' | 'unknown';

// ── Enriched token event with extracted metadata ──

export interface EnrichedTokenEventData {
  uuid: string;
  timestamp: string;
  model: string;
  usage: TokenUsage;
  toolsUsed: string[];
  stopReason: string;
  isSidechain: boolean;
  parentUuid?: string;
  semanticPhase: SemanticPhase;
  content?: string;
  contentHash?: string;
  messageId?: string;
  requestId?: string;
  slug?: string;
  apiErrorStatus?: string;
  isApiError?: boolean;
  serviceTier?: string;
  speed?: string;
  cache1h?: number;
  cache5m?: number;
  webSearchCount?: number;
  webFetchCount?: number;
  iterationsCount?: number;
  hasThinking?: boolean;
  permissionMode?: string;
}

// ── Token event for client/UI consumption ──

export interface TokenEvent {
  id: number;
  sessionId: string;
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}
