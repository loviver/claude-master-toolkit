// ── Session JSONL event types ──

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface SessionEvent {
  type: 'user' | 'assistant' | 'permission-mode' | 'system' | 'attachment' | 'file-history-snapshot' | 'last-prompt';
  uuid: string;
  sessionId: string;
  timestamp: string;
  parentUuid?: string;
  isSidechain?: boolean;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  entrypoint?: string;
  permissionMode?: string;
  userType?: string;
  requestId?: string;
  slug?: string;
  apiErrorStatus?: string;
  isApiErrorMessage?: boolean;
  // system subtypes
  subtype?: string;
  durationMs?: number;
  messageCount?: number;
  isMeta?: boolean;
  // attachment event
  attachment?: {
    type?: string;
    hookName?: string;
    hookEvent?: string;
    toolUseID?: string;
    content?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    command?: string;
    durationMs?: number;
  };
  // file-history-snapshot
  messageId?: string;
  isSnapshotUpdate?: boolean;
  snapshot?: {
    messageId?: string;
    trackedFileBackups?: Record<string, { backupFileName?: string; version?: number; backupTime?: string }>;
    timestamp?: string;
  };
  // user events with tool results
  toolUseResult?: {
    stdout?: string;
    stderr?: string;
    interrupted?: boolean;
    isImage?: boolean;
    noOutputExpected?: boolean;
    exitCode?: number;
  };
  sourceToolAssistantUUID?: string;
  promptId?: string;
  message?: {
    role: 'user' | 'assistant';
    content: unknown;
    model?: string;
    id?: string;
    stop_reason?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
      cache_creation_input_tokens: number;
      server_tool_use?: {
        web_search_requests?: number;
        web_fetch_requests?: number;
      } & Record<string, unknown>;
      service_tier?: string;
      speed?: string;
      iterations?: Array<Record<string, unknown>>;
      cache_creation?: {
        ephemeral_5m_input_tokens: number;
        ephemeral_1h_input_tokens: number;
      };
    };
  };
}

// ── Semantic Phases ──

export type SemanticPhase = 'exploration' | 'implementation' | 'testing' | 'unknown';

// ── Enriched Token Event ──

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

// ── Auxiliary extractor outputs ──

export interface HookAttachment {
  parentUuid?: string;
  uuid?: string;
  hookName: string;
  hookEvent: string;
  exitCode?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  command?: string;
  timestamp: string;
}

export interface FileHistorySnapshot {
  messageId: string;
  isSnapshotUpdate: boolean;
  files: string[];
  timestamp?: string;
}

// ── Model + Pricing ──

export type ModelAlias = 'opus' | 'sonnet' | 'haiku';

export type ModelPreference = 'inherit' | 'auto' | 'smart' | ModelAlias | `pinned:${string}`;

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CostBreakdown {
  model: string;
  tokens: TokenUsage;
  costUsd: number;
  windowUsagePct: number;
}

// ── Pandorica Memory ──

export type MemoryType = 'bugfix' | 'decision' | 'architecture' | 'discovery' | 'pattern' | 'config' | 'preference';

export interface Memory {
  id: string;
  title: string;
  type: MemoryType;
  scope: 'project' | 'personal';
  topicKey?: string;
  content: string;
  projectPath?: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
}

// ── CLI Output ──

export interface CliOutput<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ── Dashboard API ──

export interface SessionSummary {
  id: string;
  projectPath: string;
  startedAt: number;
  lastActiveAt: number;
  primaryModel: string;
  gitBranch?: string;
  turnCount: number;
  tokens: TokenUsage;
  costUsd: number;
}

export interface SessionDetail extends SessionSummary {
  events: TokenEvent[];
  modelBreakdown: Record<string, TokenUsage & { costUsd: number }>;
}

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

export interface TimelinePoint {
  date: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  sessions: number;
}

export interface ModelBreakdown {
  model: string;
  totalTokens: number;
  costUsd: number;
  sessionCount: number;
  percentage: number;
}
