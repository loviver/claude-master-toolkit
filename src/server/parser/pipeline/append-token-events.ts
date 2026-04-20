import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { tokenEvents, turnToolCalls, turnContent } from '../../db/schema.js';
import { sessionBus } from '../../events/bus.js';
import { eventToTokenRow } from '../mappers/event-to-token-row.js';
import { eventToToolCalls } from '../mappers/event-to-tool-calls.js';
import { eventToAssistantContent } from '../mappers/event-to-assistant-content.js';
import type { SyncContext, RefMaps } from '../types.js';

export function appendTokenEvents(
  db: BetterSQLite3Database,
  ctx: SyncContext,
  refs: RefMaps,
  durationByUuid: Map<string, number>,
): void {
  for (const evt of ctx.enrichedEvts) {
    if (evt.uuid && refs.priorUuids.has(evt.uuid)) continue;

    const durationMs = evt.uuid ? (durationByUuid.get(evt.uuid) ?? null) : null;
    const row = eventToTokenRow(evt, ctx.meta.sessionId, durationMs);

    const inserted = db.insert(tokenEvents).values(row).returning({ id: tokenEvents.id }).get();
    if (!inserted) continue;

    refs.newEventIds.add(inserted.id);
    if (evt.uuid) refs.uuidToEventId.set(evt.uuid, inserted.id);
    if (evt.messageId) refs.messageIdToEventId.set(evt.messageId, inserted.id);

    sessionBus.emitEvent({ type: 'turn:appended', sessionId: ctx.meta.sessionId, eventId: inserted.id, at: Date.now() });

    for (const tcRow of eventToToolCalls(evt, inserted.id)) {
      db.insert(turnToolCalls).values(tcRow).run();
    }

    const contentRow = eventToAssistantContent(evt, inserted.id);
    if (contentRow) db.insert(turnContent).values(contentRow).run();
  }
}
