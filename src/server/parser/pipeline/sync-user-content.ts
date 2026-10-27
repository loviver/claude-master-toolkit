import type { AppDb } from '../../../shared/db/db.js';
import { createHash } from 'crypto';
import { turnContent } from '../../../shared/db/schema.js';
import { userEventToContent } from '../mappers/user-event-to-content.js';
import type { SyncContext, RefMaps } from '../types.js';

export function syncUserContent(db: AppDb, ctx: SyncContext, refs: RefMaps): void {
  for (const { assistantUuid, role, raw } of ctx.userContent) {
    const evId = refs.uuidToEventId.get(assistantUuid);
    if (!evId || !refs.newEventIds.has(evId)) continue;

    const hash = createHash('sha256').update(raw).digest('hex');
    const size = Buffer.byteLength(raw, 'utf-8');
    db.insert(turnContent).values(userEventToContent(raw, hash, size, evId, role)).run();
  }
}
