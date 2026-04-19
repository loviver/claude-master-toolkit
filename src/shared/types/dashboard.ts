import type { TokenUsage } from './base.js';
import type { TokenEvent } from './token-event.js';

// ── Hook attachment metadata (session-level events) ──

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

// ── File history tracking ──

export interface FileHistorySnapshot {
  messageId: string;
  isSnapshotUpdate: boolean;
  files: string[];
  timestamp?: string;
}

// ── Dashboard: session summary view ──

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

// ── Dashboard: session detail view ──

export interface SessionDetail extends SessionSummary {
  events: TokenEvent[];
  modelBreakdown: Record<string, TokenUsage & { costUsd: number }>;
}
