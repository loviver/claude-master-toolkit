import type { SessionEvent } from './session-event.js';

// ── Type guards for SessionEvent variants ──

export function isAssistantEvent(e: SessionEvent): e is SessionEvent & { type: 'assistant' } {
  return e.type === 'assistant';
}

export function isUserEvent(e: SessionEvent): e is SessionEvent & { type: 'user' } {
  return e.type === 'user';
}

export function isAttachmentEvent(e: SessionEvent): e is SessionEvent & { type: 'attachment' } {
  return e.type === 'attachment';
}

export function isFileSnapshotEvent(e: SessionEvent): e is SessionEvent & { type: 'file-history-snapshot' } {
  return e.type === 'file-history-snapshot';
}

export function isPermissionModeEvent(e: SessionEvent): e is SessionEvent & { type: 'permission-mode' } {
  return e.type === 'permission-mode';
}

export function isSystemEvent(e: SessionEvent): e is SessionEvent & { type: 'system' } {
  return e.type === 'system';
}

export function isLastPromptEvent(e: SessionEvent): e is SessionEvent & { type: 'last-prompt' } {
  return e.type === 'last-prompt';
}
