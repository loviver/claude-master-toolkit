import type { FileHistorySnapshot } from '../../../shared/types/dashboard.js';

export function snapshotToRows(
  snap: FileHistorySnapshot,
  sessionId: string,
  uuidToEventId: Map<string, number>,
) {
  const eventId = uuidToEventId.get(snap.messageId) ?? null;
  const ts = snap.timestamp ? new Date(snap.timestamp).getTime() : null;
  return snap.files.map((filePath) => ({
    sessionId,
    eventId,
    messageId: snap.messageId,
    filePath,
    isSnapshotUpdate: snap.isSnapshotUpdate,
    timestamp: ts,
  }));
}
