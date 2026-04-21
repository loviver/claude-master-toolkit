/**
 * CLI command option shapes for `ctk mem` (and legacy `ctk pandorica`).
 *
 * Derived from domain types in src/shared/memories/types.ts via Pick/Omit.
 * CLI-only concerns (content sources, string-encoded limits from Commander)
 * are composed on top.
 *
 * NO inline `opts: { ... }` in command signatures — import from here.
 */

import type {
  SaveInput,
  RecallInput,
  ContextInput,
  TraceInput,
} from '../../shared/memories/types.js';

// ── Shared: content sources (CLI-only input surface) ──

export interface ContentSource {
  content?: string;
  file?: string;
  stdin?: boolean;
}

// ── `mem save` ──

export type MemSaveOpts = Pick<
  SaveInput,
  'title' | 'what' | 'why' | 'where' | 'learned' | 'topicKey' | 'scope' | 'projectPath' | 'sessionId'
> &
  ContentSource & {
    /** Validated at runtime against VALID_TYPES (kept as plain string for Commander). */
    type?: string;
  };

// ── `mem recall <query>` ──

export type MemRecallOpts = Omit<RecallInput, 'query' | 'limit'> & {
  /** Commander passes --limit as a string; parsed to number in the command. */
  limit?: string;
};

// ── `mem context` ──

export type MemContextOpts = Omit<ContextInput, 'limit'> & { limit?: string };

// ── `mem trace` ──

export type MemTraceOpts = Omit<TraceInput, 'limit'> & { limit?: string };

// ── `mem summary` ──

export type MemSummaryOpts = ContentSource & {
  title?: string;
  sessionId?: string;
  projectPath?: string;
};

// ── `mem stats` ──

export interface MemStatsOpts {
  projectPath?: string;
  all?: boolean;
}

// ── `mem export` ──

export type MemExportOpts = MemStatsOpts & { out?: string };

// ── `mem import` ──

export interface MemImportOpts {
  file?: string;
  stdin?: boolean;
}
