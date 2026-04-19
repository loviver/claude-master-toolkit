import type Database from 'better-sqlite3';
import type { MemoryRow, StatsInput, StatsOut, VaultDump } from './types.js';

// ── Stats aggregation ──

export function stats(db: Database.Database, input: StatsInput): StatsOut {
  const scopeParts: string[] = [];
  const args: unknown[] = [];
  if (input.projectPath) { scopeParts.push('project_path = ?'); args.push(input.projectPath); }
  const where = scopeParts.length ? `WHERE ${scopeParts.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS c FROM memories_v2 ${where}`).get(...args) as { c: number };
  const byType = db.prepare(
    `SELECT type, COUNT(*) AS c FROM memories_v2 ${where} GROUP BY type`,
  ).all(...args) as Array<{ type: string | null; c: number }>;

  const memoriesByType: Record<string, number> = {};
  for (const r of byType) memoriesByType[r.type ?? 'untyped'] = r.c;

  const recallQueries = (db.prepare(`SELECT COUNT(*) AS c FROM memory_searches`).get() as { c: number }).c;

  const savedSum = (db.prepare(
    `SELECT COALESCE(SUM(cost_saved_usd), 0) AS s FROM memories_v2 ${where}`,
  ).get(...args) as { s: number }).s;

  const top = db.prepare(
    `SELECT id, title, access_count, cost_saved_usd FROM memories_v2 ${where}
     ORDER BY access_count DESC LIMIT 5`,
  ).all(...args) as Array<{ id: string; title: string; access_count: number; cost_saved_usd: number }>;

  return {
    memoriesTotal: total.c,
    memoriesByType,
    recallQueries,
    totalCostSaved: savedSum,
    topAccessed: top.map((t) => ({
      id: t.id,
      title: t.title,
      accessCount: t.access_count,
      costSavedUsd: t.cost_saved_usd,
    })),
  };
}

// ── Export full vault ──

export function exportVault(db: Database.Database, input: { projectPath?: string }): VaultDump {
  const parts: string[] = [];
  const args: unknown[] = [];
  if (input.projectPath) { parts.push('project_path = ?'); args.push(input.projectPath); }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const memories = db.prepare(`SELECT * FROM memories_v2 ${where}`).all(...args) as MemoryRow[];
  const searches = db.prepare(`SELECT * FROM memory_searches`).all() as VaultDump['searches'];
  return { version: 2, memories, searches };
}

// ── Import vault dump (idempotent via INSERT OR IGNORE) ──

export function importVault(db: Database.Database, dump: VaultDump): { imported: number; skipped: number } {
  let imported = 0;
  let skipped = 0;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO memories_v2 (
       id, session_id, title, type, what, why, where_, learned, topic_key,
       model, phase, tokens_input, tokens_output, cache_hit_pct, cost_usd,
       access_count, cost_saved_usd,
       scope, project_path, description, file_path,
       created_at, updated_at, accessed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const m of dump.memories) {
    const info = insert.run(
      m.id, m.session_id, m.title, m.type, m.what, m.why, m.where_, m.learned, m.topic_key,
      m.model, m.phase, m.tokens_input, m.tokens_output, m.cache_hit_pct, m.cost_usd,
      m.access_count, m.cost_saved_usd,
      m.scope, m.project_path, m.description, m.file_path,
      m.created_at, m.updated_at, m.accessed_at,
    );
    if (info.changes > 0) imported++; else skipped++;
  }
  return { imported, skipped };
}
