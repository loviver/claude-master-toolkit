/**
 * CLI option shapes for legacy `ctk pandorica <subcmd>`.
 *
 * This surface is DEPRECATED — new work should prefer `ctk mem`.
 * Kept only for backward-compat. Types live here (not inline) so the
 * migration to `mem` is a rename, not a rewrite.
 *
 * Legacy type vocabulary (`discovery`, `config`) is mapped to v2 in
 * commands/pandorica.ts via `mapType()`.
 */

import type { ContentSource } from './mem-opts.js';

export type LegacyPandoricaType =
  | 'bugfix'
  | 'decision'
  | 'architecture'
  | 'discovery'
  | 'pattern'
  | 'config'
  | 'preference'
  | 'session_summary';

export type PandoricaSaveOpts = ContentSource & {
  title?: string;
  type?: string;
  scope?: string;
  topicKey?: string;
  projectPath?: string;
  sessionId?: string;
};

export interface PandoricaSearchOpts {
  limit?: string;
  type?: string;
  scope?: string;
  projectPath?: string;
}

export interface PandoricaContextOpts {
  projectPath?: string;
  sessionId?: string;
  limit?: string;
}

export interface PandoricaRecentOpts {
  limit?: string;
  all?: boolean;
}

export type PandoricaSummaryOpts = ContentSource & {
  sessionId?: string;
  projectPath?: string;
  title?: string;
};
