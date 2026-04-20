import type { TokenUsage } from '../../shared/types/index.js';
import type { EnrichedTokenEventData } from '../../shared/types/token-event.js';
import type { HookAttachment, FileHistorySnapshot } from '../../shared/types/dashboard.js';
import type { SessionEvent } from '../../shared/types/session-event.js';

export interface SessionMeta {
  sessionId: string;
  startedAt: string;
  lastActiveAt: string;
  cwd: string;
  gitBranch?: string;
  version?: string;
  primaryModel: string;
  turnCount: number;
  customTitle?: string;
  lastPrompt?: string;
  entrypoint?: string;
}

export interface SyncContext {
  filePath: string;
  projectPath: string;
  meta: SessionMeta;
  enrichedEvts: EnrichedTokenEventData[];
  totals: TokenUsage;
  cost: number;
  hooks: HookAttachment[];
  snapshots: FileHistorySnapshot[];
  allEvents: SessionEvent[];
  priorSession: { id: string } | undefined;
}

export interface RefMaps {
  uuidToEventId: Map<string, number>;
  messageIdToEventId: Map<string, number>;
  priorUuids: Set<string>;
  newEventIds: Set<number>;
}
