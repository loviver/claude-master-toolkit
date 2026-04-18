/**
 * Shared API DTOs — single source of truth for server responses and client consumers.
 * Do not import runtime code here (keep it pure types to be safe across cjs/esm builds).
 */

export type ModelKey = 'opus' | 'sonnet' | 'haiku' | 'unknown';
export type Phase = 'exploration' | 'implementation' | 'testing' | 'unknown';

// Strict known reasons plus `string & {}` escape hatch so autocomplete stays useful
// without forbidding unknown values coming from the API.
export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | (string & {});

export interface SessionGraphNodeDTO {
  id: string;
  turnIdx: number;
  model: string;
  modelKey: ModelKey;
  isSidechain: boolean;
  phase: Phase;
  tools: string[];
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitPct: number;
  stopReason: StopReason | null;
  costUsd: number;
  parentId: string | null;
  timestamp: number;
  // v7 enrichment (all optional — older rows may lack these)
  requestId?: string | null;
  slug?: string | null;
  messageId?: string | null;
  apiErrorStatus?: string | null;
  isApiError?: boolean;
  serviceTier?: string | null;
  speed?: string | null;
  cache1h?: number;
  cache5m?: number;
  webSearchCount?: number;
  webFetchCount?: number;
  iterationsCount?: number;
  durationMs?: number | null;
  permissionMode?: string | null;
  hasThinking?: boolean;
  hooksCount?: number;
  filesChangedCount?: number;
}

export interface SessionGraphEdgeDTO {
  from: string;
  to: string;
  kind: 'chain' | 'sidechain';
}

export interface SessionGraphDTO {
  nodes: SessionGraphNodeDTO[];
  edges: SessionGraphEdgeDTO[];
}

export interface TurnToolCall {
  tool: string;
  inputPreview: string;
  resultPreview: string | null;
  toolUseId?: string;
  isError?: boolean;
  exitCode?: number | null;
  stderr?: string | null;
  interrupted?: boolean;
  isImage?: boolean;
}

export interface ThinkingBlockDTO {
  text: string;
  signature?: string;
}

export interface TurnHookDTO {
  name: string;
  event: string;
  exitCode?: number | null;
  durationMs?: number | null;
  stderr?: string | null;
}

export interface TurnContentDTO {
  eventId: number;
  role: 'user' | 'assistant';
  byteSize: number;
  assistantText: string | null;
  userPrompt: string | null;
  toolCalls: TurnToolCall[];
  thinkingBlocks?: ThinkingBlockDTO[];
  filesChanged?: string[];
  hooks?: TurnHookDTO[];
  permissionMode?: string | null;
  requestId?: string | null;
  slug?: string | null;
}

export interface TurnPairDTO {
  userEvent: {
    eventId: number;
    role: 'user';
    userPrompt: string | null;
    byteSize: number;
  } | null;
  assistantEvent: {
    eventId: number;
    role: 'assistant';
    assistantText: string | null;
    toolCalls: TurnToolCall[];
    agentRole: string | null;
    byteSize: number;
    thinkingBlocks?: ThinkingBlockDTO[];
    filesChanged?: string[];
    hooks?: TurnHookDTO[];
    permissionMode?: string | null;
    requestId?: string | null;
    slug?: string | null;
    apiErrorStatus?: string | null;
    isApiError?: boolean;
  };
}
