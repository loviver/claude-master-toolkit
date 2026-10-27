import type { AppDb } from '../../../shared/db/db.js';
import { sessions } from '../../../shared/db/schema.js';
import { metaToSessionInsert, metaToSessionUpdate } from '../mappers/meta-to-session-row.js';
import type { SyncContext } from '../types.js';

export function upsertSession(db: AppDb, ctx: SyncContext): void {
  db.insert(sessions)
    .values(metaToSessionInsert(ctx.meta, ctx.totals, ctx.cost, ctx.filePath, ctx.projectPath, ctx.agent))
    .onConflictDoUpdate({
      target: sessions.id,
      set: metaToSessionUpdate(ctx.meta, ctx.totals, ctx.cost),
    })
    .run();
}
