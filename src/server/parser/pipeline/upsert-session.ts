import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { sessions } from '../../../shared/db/schema.js';
import { metaToSessionInsert, metaToSessionUpdate } from '../mappers/meta-to-session-row.js';
import type { SyncContext } from '../types.js';

export function upsertSession(db: BetterSQLite3Database, ctx: SyncContext): void {
  db.insert(sessions)
    .values(metaToSessionInsert(ctx.meta, ctx.totals, ctx.cost, ctx.filePath, ctx.projectPath))
    .onConflictDoUpdate({
      target: sessions.id,
      set: metaToSessionUpdate(ctx.meta, ctx.totals, ctx.cost),
    })
    .run();
}
