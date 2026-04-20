import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createHash } from 'crypto';
import { turnContent } from '../../db/schema.js';
import { userEventToContent } from '../mappers/user-event-to-content.js';
import type { SyncContext, RefMaps } from '../types.js';
import type { SessionEvent } from '../../../shared/types/session-event.js';

export function syncUserContent(db: BetterSQLite3Database, ctx: SyncContext, refs: RefMaps): void {
  const events = ctx.allEvents as SessionEvent[];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type !== 'user' || !ev.message) continue;

    const raw = JSON.stringify(ev.message.content);
    const hash = createHash('sha256').update(raw).digest('hex');
    const size = Buffer.byteLength(raw, 'utf-8');

    if (ev.sourceToolAssistantUUID) {
      const evId = refs.uuidToEventId.get(ev.sourceToolAssistantUUID);
      if (evId && refs.newEventIds.has(evId)) {
        db.insert(turnContent).values(userEventToContent(raw, hash, size, evId, 'tool_result')).run();
      }
      continue;
    }

    for (let j = i + 1; j < events.length; j++) {
      const nxt = events[j];
      if (nxt.type !== 'assistant') continue;
      const evId = nxt.uuid ? refs.uuidToEventId.get(nxt.uuid) : undefined;
      if (evId && refs.newEventIds.has(evId)) {
        db.insert(turnContent).values(userEventToContent(raw, hash, size, evId, 'user')).run();
      }
      break;
    }
  }
}
