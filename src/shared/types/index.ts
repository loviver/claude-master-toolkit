// ── Base types ──
export type { TokenUsage, CliOutput } from './base.js';

// ── Session event types ──
export type {
  SessionAttachment,
  SnapshotBackup,
  FileSnapshot,
  ToolUseResult,
  UsageMetadata,
  SessionMessage,
  SessionEvent,
} from './session-event.js';

// ── Token event types ──
export type { SemanticPhase, EnrichedTokenEventData, TokenEvent } from './token-event.js';

// ── Memory types ──
export type { MemoryType, Memory } from './memory.js';

// ── Model pricing types ──
export type { ModelAlias, ModelPreference, ModelPricing, CostBreakdown } from './models.js';

// ── Timeline types ──
export type { TimelinePoint, ModelBreakdown } from './timeline.js';

// ── Dashboard types ──
export type { HookAttachment, FileHistorySnapshot, SessionSummary, SessionDetail } from './dashboard.js';

// ── Type guards for SessionEvent ──
export {
  isAssistantEvent,
  isUserEvent,
  isAttachmentEvent,
  isFileSnapshotEvent,
  isPermissionModeEvent,
  isSystemEvent,
  isLastPromptEvent,
} from './semantics.js';

// ── Branded ID types ──
export type { SessionId, MessageId, UUId, RequestId, ToolId } from './ids.js';
export { brandSessionId, brandMessageId, brandUUId, brandRequestId, brandToolId } from './ids.js';

// ── General type guard utilities ──
export {
  isRecord,
  isArray,
  isString,
  isNumber,
  isBoolean,
  hasProperty,
  hasProperties,
  isStringRecord,
  isNumberRecord,
} from './type-guards.js';
