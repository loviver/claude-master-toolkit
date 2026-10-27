import type { AgentId } from '../../../shared/agents/interface.js';
import type { EnrichedTokenEventData } from '../../../shared/types/token-event.js';
import type { HookAttachment, FileHistorySnapshot, UserContentEntry } from '../../../shared/types/index.js';
import type { SessionMeta } from '../types.js';

/**
 * Agent-agnostic session, the only shape the sync pipeline consumes.
 * Optional capabilities (hooks, snapshots, ...) are empty when an agent lacks them.
 */
export interface NormalizedSession {
  meta: SessionMeta;
  projectPath: string;
  tokenEvents: EnrichedTokenEventData[];
  /** Assistant turn uuid → wall-clock duration. */
  turnDurations: Map<string, number>;
  hooks: HookAttachment[];
  snapshots: FileHistorySnapshot[];
  userContent: UserContentEntry[];
}

/** Port: one adapter per agent knows where its session files live and how to read them. */
export interface SessionSource {
  readonly agent: AgentId;
  /** Session files to sync on a full scan. */
  discover(): string[];
  /** Globs the watcher observes for live changes. */
  watchGlobs(): string[];
  owns(filePath: string): boolean;
  read(filePath: string): Promise<NormalizedSession>;
}
