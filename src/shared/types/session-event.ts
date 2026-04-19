// ── Attachment metadata (hook outputs, tool results) ──

export interface SessionAttachment {
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
}

// ── File history snapshot structure ──

export interface SnapshotBackup {
  backupFileName?: string;
  version?: number;
  backupTime?: string;
}

export interface FileSnapshot {
  messageId?: string;
  trackedFileBackups?: Record<string, SnapshotBackup>;
  timestamp?: string;
}

// ── Tool result metadata ──

export interface ToolUseResult {
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  isImage?: boolean;
  noOutputExpected?: boolean;
  exitCode?: number;
}

// ── Usage metadata in assistant messages ──

export interface UsageMetadata {
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
}

// ── Session message (user/assistant turn) ──

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: unknown;
  model?: string;
  id?: string;
  stop_reason?: string;
  usage?: UsageMetadata;
}

// ── Discriminated union: SessionEvent ──

export type SessionEvent = {
  type: 'user' | 'assistant';
  message: SessionMessage;
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
  sourceToolAssistantUUID?: string;
  promptId?: string;
  messageId?: string;
  toolUseResult?: ToolUseResult;
} | {
  type: 'attachment';
  attachment: SessionAttachment;
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
} | {
  type: 'file-history-snapshot';
  snapshot: FileSnapshot;
  uuid: string;
  sessionId: string;
  timestamp: string;
  parentUuid?: boolean;
  isSidechain?: boolean;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  entrypoint?: string;
  isSnapshotUpdate?: boolean;
} | {
  type: 'permission-mode' | 'system' | 'last-prompt';
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
  subtype?: string;
  durationMs?: number;
  messageCount?: number;
  isMeta?: boolean;
};
