import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { turnHooks } from '../../../shared/db/schema.js';
import { hookToRow } from '../mappers/hook-to-row.js';
import type { SyncContext, RefMaps } from '../types.js';

export function rebuildTurnHooks(db: BetterSQLite3Database, ctx: SyncContext, refs: RefMaps): void {
  db.delete(turnHooks).where(eq(turnHooks.sessionId, ctx.meta.sessionId)).run();
  for (const hook of ctx.hooks) {
    db.insert(turnHooks).values(hookToRow(hook, ctx.meta.sessionId, refs.uuidToEventId)).run();
  }
}
