import { eq } from 'drizzle-orm';
import type { AppDb } from '../../../shared/db/db.js';
import { turnFileChanges } from '../../../shared/db/schema.js';
import { snapshotToRows } from '../mappers/snapshot-to-rows.js';
import type { SyncContext, RefMaps } from '../types.js';

export function syncFileSnapshots(db: AppDb, ctx: SyncContext, refs: RefMaps): void {
  db.delete(turnFileChanges).where(eq(turnFileChanges.sessionId, ctx.meta.sessionId)).run();
  for (const snap of ctx.snapshots) {
    for (const row of snapshotToRows(snap, ctx.meta.sessionId, refs.uuidToEventId)) {
      db.insert(turnFileChanges).values(row).run();
    }
  }
}
