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
  // v9
  thinkingText?: string;
  thinkingSignature?: string;
  promptId?: string;
  cwd?: string;
  gitBranch?: string;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  userType?: string;
  toolCalls?: ToolCallData[];
  // v10 event-level extras
  eventSubtype?: string;
  eventLevel?: string;
}

export interface ToolCallData {
  toolUseId: string;
  toolName: string;
  orderIdx: number;
  inputJson: string | null;
  resultIsError: boolean | null;
  resultContent: string | null;
  resultStderr: string | null;
  resultStdout: string | null;
  resultExitCode: number | null;
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
