import { statSync, existsSync } from 'fs';
import { eq } from 'drizzle-orm';
import { getDb } from '../../shared/db/db.js';
import { sessions, syncState } from '../../shared/db/schema.js';
import { computeTokenTotals } from './aggregators/token-totals.js';
import { computeTotalCost } from './aggregators/cost-total.js';
import { loadRefMaps } from './builders/ref-maps.js';
import { upsertSession } from './pipeline/upsert-session.js';
import { appendTokenEvents } from './pipeline/append-token-events.js';
import { rebuildTurnHooks } from './pipeline/rebuild-turn-hooks.js';
import { syncUserContent } from './pipeline/sync-user-content.js';
import { syncFileSnapshots } from './pipeline/sync-file-snapshots.js';
import { persistSyncState } from './pipeline/persist-sync-state.js';
import { emitSessionEvent } from './pipeline/emit-session-event.js';
import { sourceFor } from './sources/registry.js';
import type { SessionSource } from './sources/types.js';
import type { SyncContext } from './types.js';

export async function syncFile(
  filePath: string,
  source: SessionSource | undefined = sourceFor(filePath),
): Promise<void> {
  if (!source || !existsSync(filePath)) return;

  const db = getDb();
  const stat = statSync(filePath);

  const existing = db.select().from(syncState).where(eq(syncState.filePath, filePath)).get();
  if (existing?.lastModified === stat.mtimeMs) return;

  const session = await source.read(filePath);
  const { meta, tokenEvents: enrichedEvts } = session;
  const priorSession = db.select().from(sessions).where(eq(sessions.id, meta.sessionId)).get();
  const refs = loadRefMaps(db, meta.sessionId);

  const ctx: SyncContext = {
    agent: source.agent,
    filePath,
    projectPath: session.projectPath,
    meta,
    enrichedEvts,
    totals: computeTokenTotals(enrichedEvts),
    cost: computeTotalCost(enrichedEvts),
    hooks: session.hooks,
    snapshots: session.snapshots,
    userContent: session.userContent,
    priorSession,
  };

  db.transaction(() => {
    upsertSession(db, ctx);
    appendTokenEvents(db, ctx, refs, session.turnDurations);
    rebuildTurnHooks(db, ctx, refs);
    syncUserContent(db, ctx, refs);
    syncFileSnapshots(db, ctx, refs);
    persistSyncState(db, filePath, stat);
  });

  emitSessionEvent(priorSession, meta.sessionId);
}
