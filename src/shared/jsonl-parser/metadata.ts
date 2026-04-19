import type { SessionEvent, HookAttachment, FileHistorySnapshot } from '../types/index.js';

// ── Turn duration mapping ──

/**
 * Map `system.turn_duration` events to their owning assistant turn's uuid
 * (the system event's parentUuid).
 */
export function extractTurnDurations(events: SessionEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'system' && e.subtype === 'turn_duration' && e.parentUuid && typeof e.durationMs === 'number') {
      out.set(e.parentUuid, e.durationMs);
    }
  }
  return out;
}

// ── Hook attachment extraction ──

/**
 * Extract hook-related attachment events.
 */
export function extractHookAttachments(events: SessionEvent[]): HookAttachment[] {
  const out: HookAttachment[] = [];
  for (const e of events) {
    if (e.type !== 'attachment' || !e.attachment) continue;
    const a = e.attachment;
    if (!a.hookName || !a.hookEvent) continue;
    out.push({
      parentUuid: e.parentUuid,
      uuid: e.uuid,
      hookName: a.hookName,
      hookEvent: a.hookEvent,
      exitCode: a.exitCode,
      durationMs: a.durationMs,
      stdout: a.stdout,
      stderr: a.stderr,
      command: a.command,
      timestamp: e.timestamp,
    });
  }
  return out;
}

// ── File history snapshots ──

/**
 * Extract file-history-snapshot events. `messageId` matches assistant turn uuid.
 */
export function extractFileHistorySnapshots(events: SessionEvent[]): FileHistorySnapshot[] {
  const out: FileHistorySnapshot[] = [];
  for (const e of events) {
    if (e.type !== 'file-history-snapshot') continue;
    const mid = (e as { messageId?: string }).messageId ?? e.snapshot?.messageId;
    if (!mid) continue;
    const tfb = e.snapshot?.trackedFileBackups ?? {};
    const files = Object.keys(tfb);
    if (files.length === 0) continue;
    out.push({
      messageId: mid,
      isSnapshotUpdate: !!e.isSnapshotUpdate,
      files,
      timestamp: e.snapshot?.timestamp,
    });
  }
  return out;
}
