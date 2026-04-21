import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { tokenEvents, sessions } from '../../../shared/db/schema.js';
import type { RefMaps } from '../types.js';

export function loadRefMaps(db: BetterSQLite3Database, sessionId: string): RefMaps {
  const priorUuids = new Set<string>();
  const uuidToEventId = new Map<string, number>();
  const messageIdToEventId = new Map<string, number>();

  const priorSession = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (priorSession) {
    for (const row of db
      .select({ id: tokenEvents.id, uuid: tokenEvents.uuid, messageId: tokenEvents.messageId })
      .from(tokenEvents)
      .where(eq(tokenEvents.sessionId, sessionId))
      .all()) {
      if (row.uuid) {
        priorUuids.add(row.uuid);
        uuidToEventId.set(row.uuid, row.id);
      }
      if (row.messageId) messageIdToEventId.set(row.messageId, row.id);
    }
  }

  return { priorUuids, uuidToEventId, messageIdToEventId, newEventIds: new Set() };
}
