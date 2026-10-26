import { eq } from 'drizzle-orm';
import type { AppDb } from '../../../shared/db/db.js';
import { turnHooks } from '../../../shared/db/schema.js';
import { hookToRow } from '../mappers/hook-to-row.js';
import type { SyncContext, RefMaps } from '../types.js';

export function rebuildTurnHooks(db: AppDb, ctx: SyncContext, refs: RefMaps): void {
  db.delete(turnHooks).where(eq(turnHooks.sessionId, ctx.meta.sessionId)).run();
  for (const hook of ctx.hooks) {
    db.insert(turnHooks).values(hookToRow(hook, ctx.meta.sessionId, refs.uuidToEventId)).run();
  }
}
