import { statSync, existsSync } from 'fs';
import { basename, dirname } from 'path';
import { eq } from 'drizzle-orm';
import { getDb } from '../../shared/db/db.js';
import { sessions, syncState } from '../../shared/db/schema.js';
import {
  parseJsonlFile,
  extractEnrichedTokenEvents,
  extractSessionMeta,
  extractTurnDurations,
  extractHookAttachments,
  extractFileHistorySnapshots,
} from '../../shared/jsonl-parser/index.js';
import { computeTokenTotals } from './aggregators/token-totals.js';
import { computeTotalCost } from './aggregators/cost-total.js';
import { loadRefMaps } from './builders/ref-maps.js';
import { decodeProjectDir } from './extractors/project-dir.js';
import { upsertSession } from './pipeline/upsert-session.js';
import { appendTokenEvents } from './pipeline/append-token-events.js';
import { rebuildTurnHooks } from './pipeline/rebuild-turn-hooks.js';
import { syncUserContent } from './pipeline/sync-user-content.js';
import { syncFileSnapshots } from './pipeline/sync-file-snapshots.js';
import { persistSyncState } from './pipeline/persist-sync-state.js';
import { emitSessionEvent } from './pipeline/emit-session-event.js';
import type { SyncContext } from './types.js';

export async function syncFile(filePath: string): Promise<void> {
  if (!existsSync(filePath)) return;

  const db = getDb();
  const stat = statSync(filePath);

  const existing = db.select().from(syncState).where(eq(syncState.filePath, filePath)).get();
  if (existing?.lastModified === stat.mtimeMs) return;

  const allEvents = await parseJsonlFile(filePath);
  const meta = extractSessionMeta(allEvents);
  const enrichedEvts = extractEnrichedTokenEvents(allEvents);
  const totals = computeTokenTotals(enrichedEvts);
  const cost = computeTotalCost(enrichedEvts);
  const projectPath = meta.cwd || decodeProjectDir(basename(dirname(filePath)));
  const priorSession = db.select().from(sessions).where(eq(sessions.id, meta.sessionId)).get();
  const refs = loadRefMaps(db, meta.sessionId);
  const durationByUuid = extractTurnDurations(allEvents);
  const hooks = extractHookAttachments(allEvents);
  const snapshots = extractFileHistorySnapshots(allEvents);

  const ctx: SyncContext = {
    filePath,
    projectPath,
    meta,
    enrichedEvts,
    totals,
    cost,
    hooks,
    snapshots,
    allEvents,
    priorSession,
  };

  db.transaction(() => {
    upsertSession(db, ctx);
    appendTokenEvents(db, ctx, refs, durationByUuid);
    rebuildTurnHooks(db, ctx, refs);
    syncUserContent(db, ctx, refs);
    syncFileSnapshots(db, ctx, refs);
    persistSyncState(db, filePath, stat);
  });

  emitSessionEvent(priorSession, meta.sessionId);
}
