import type Database from 'better-sqlite3';
import { openDb } from '../indexer/db-raw.js';
import { randomUUID } from 'crypto';

export type MemoryType =
  | 'decision'
  | 'bugfix'
  | 'architecture'
  | 'pattern'
  | 'preference'
  | 'reference'
  | 'note'
  | 'session_summary';

export type MemoryScope = 'project' | 'personal';

export interface MemoryRow {
  id: string;
  session_id: string | null;
  title: string;
  type: MemoryType | null;
  what: string | null;
  why: string | null;
  where_: string | null;
  learned: string | null;
  topic_key: string | null;
  model: string | null;
  phase: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cache_hit_pct: number | null;
  cost_usd: number | null;
  access_count: number;
  cost_saved_usd: number;
  created_at: number;
  updated_at: number | null;
  accessed_at: number | null;
  scope: MemoryScope;
  project_path: string | null;
  description: string | null;
  file_path: string | null;
}

export interface SaveInput {
  title: string;
  type?: MemoryType;
  what?: string;
  why?: string;
  where?: string;
  learned?: string;
  topicKey?: string;
  scope?: MemoryScope;
  projectPath?: string;
  sessionId?: string;
  model?: string;
  phase?: string;
  tokensInput?: number;
  tokensOutput?: number;
  cacheHitPct?: number;
  costUsd?: number;
  description?: string;
  filePath?: string;
}

export function openMemDb(): Database.Database {
  return openDb();
}

function rowById(db: Database.Database, id: string): MemoryRow | null {
  const row = db.prepare(`SELECT * FROM memories_v2 WHERE id = ?`).get(id) as MemoryRow | undefined;
  return row ?? null;
}

export function save(db: Database.Database, input: SaveInput): MemoryRow {
  const now = Date.now();
  const scope = input.scope ?? 'project';
  const type: MemoryType = input.type ?? 'note';

  if (input.topicKey) {
    const existing = db
      .prepare(`SELECT * FROM memories_v2 WHERE topic_key = ? AND scope = ?`)
      .get(input.topicKey, scope) as MemoryRow | undefined;
    if (existing) {
      db.prepare(
        `UPDATE memories_v2
         SET title = ?, type = ?, what = ?, why = ?, where_ = ?, learned = ?,
             project_path = ?, session_id = ?,
             model = ?, phase = ?, tokens_input = ?, tokens_output = ?,
             cache_hit_pct = ?, cost_usd = ?,
             description = ?, file_path = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(
        input.title,
        type,
        input.what ?? existing.what,
        input.why ?? existing.why,
        input.where ?? existing.where_,
        input.learned ?? existing.learned,
        input.projectPath ?? existing.project_path,
        input.sessionId ?? existing.session_id,
        input.model ?? existing.model,
        input.phase ?? existing.phase,
        input.tokensInput ?? existing.tokens_input,
        input.tokensOutput ?? existing.tokens_output,
        input.cacheHitPct ?? existing.cache_hit_pct,
        input.costUsd ?? existing.cost_usd,
        input.description ?? existing.description,
        input.filePath ?? existing.file_path,
        now,
        existing.id,
      );
      return rowById(db, existing.id)!;
    }
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO memories_v2 (
       id, session_id, title, type, what, why, where_, learned, topic_key,
       model, phase, tokens_input, tokens_output, cache_hit_pct, cost_usd,
       scope, project_path, description, file_path,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.sessionId ?? null,
    input.title,
    type,
    input.what ?? null,
    input.why ?? null,
    input.where ?? null,
    input.learned ?? null,
    input.topicKey ?? null,
    input.model ?? null,
    input.phase ?? null,
    input.tokensInput ?? null,
    input.tokensOutput ?? null,
    input.cacheHitPct ?? null,
    input.costUsd ?? null,
    scope,
    input.projectPath ?? null,
    input.description ?? null,
    input.filePath ?? null,
    now,
    now,
  );
  return rowById(db, id)!;
}

export interface UpdateInput {
  title?: string;
  type?: MemoryType;
  what?: string;
  why?: string;
  where?: string;
  learned?: string;
  topicKey?: string;
  scope?: MemoryScope;
  projectPath?: string;
  description?: string;
  filePath?: string;
  model?: string;
  phase?: string;
  tokensInput?: number;
  tokensOutput?: number;
  cacheHitPct?: number;
  costUsd?: number;
}

export function update(db: Database.Database, id: string, input: UpdateInput): MemoryRow | null {
  const existing = rowById(db, id);
  if (!existing) return null;

  db.prepare(
    `UPDATE memories_v2
     SET title = ?, type = ?, what = ?, why = ?, where_ = ?, learned = ?, topic_key = ?,
         scope = ?, project_path = ?, description = ?, file_path = ?,
         model = ?, phase = ?, tokens_input = ?, tokens_output = ?,
         cache_hit_pct = ?, cost_usd = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.title ?? existing.title,
    input.type ?? existing.type,
    input.what ?? existing.what,
    input.why ?? existing.why,
    input.where ?? existing.where_,
    input.learned ?? existing.learned,
    input.topicKey ?? existing.topic_key,
    input.scope ?? existing.scope,
    input.projectPath ?? existing.project_path,
    input.description ?? existing.description,
    input.filePath ?? existing.file_path,
    input.model ?? existing.model,
    input.phase ?? existing.phase,
    input.tokensInput ?? existing.tokens_input,
    input.tokensOutput ?? existing.tokens_output,
    input.cacheHitPct ?? existing.cache_hit_pct,
    input.costUsd ?? existing.cost_usd,
    Date.now(),
    id,
  );
  return rowById(db, id);
}

export function deleteById(db: Database.Database, id: string): boolean {
  const info = db.prepare(`DELETE FROM memories_v2 WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function mark(db: Database.Database, id: string, topicKey: string): MemoryRow | null {
  const existing = rowById(db, id);
  if (!existing) return null;
  db.prepare(`UPDATE memories_v2 SET topic_key = ?, updated_at = ? WHERE id = ?`).run(
    topicKey,
    Date.now(),
    id,
  );
  return rowById(db, id);
}

export interface RecallInput {
  query: string;
  limit?: number;
  type?: MemoryType;
  scope?: MemoryScope;
  projectPath?: string;
  sessionId?: string;
}

export interface RecallRow extends MemoryRow {
  rank: number;
}

function sanitizeFtsQuery(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  return terms.join(' ');
}

export function recall(db: Database.Database, input: RecallInput): RecallRow[] {
  const limit = input.limit ?? 20;
  const q = sanitizeFtsQuery(input.query);

  const whereParts: string[] = [];
  const args: unknown[] = [];
  if (input.type) { whereParts.push('m.type = ?'); args.push(input.type); }
  if (input.scope) { whereParts.push('m.scope = ?'); args.push(input.scope); }
  if (input.projectPath) { whereParts.push('m.project_path = ?'); args.push(input.projectPath); }
  if (input.sessionId) { whereParts.push('m.session_id = ?'); args.push(input.sessionId); }

  let results: RecallRow[] = [];
  if (q.length > 0) {
    const extraWhere = whereParts.length ? ` AND ${whereParts.join(' AND ')}` : '';
    const sql = `
      SELECT m.*, fts.rank AS rank
      FROM memories_fts fts
      JOIN memories_v2 m ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?${extraWhere}
      ORDER BY fts.rank
      LIMIT ?
    `;
    try {
      results = db.prepare(sql).all(q, ...args, limit) as RecallRow[];
    } catch {
      results = [];
    }
  }

  const now = Date.now();
  const sessionId = input.sessionId ?? null;
  if (results.length === 0) {
    db.prepare(
      `INSERT INTO memory_searches (id, session_id, memory_id, query, rank, created_at)
       VALUES (?, ?, NULL, ?, NULL, ?)`,
    ).run(randomUUID(), sessionId, input.query, now);
  } else {
    const insert = db.prepare(
      `INSERT INTO memory_searches (id, session_id, memory_id, query, rank, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const r of results) {
      insert.run(randomUUID(), sessionId, r.id, input.query, r.rank, now);
    }
  }

  return results;
}

export interface ContextInput {
  projectPath?: string;
  sessionId?: string;
  limit?: number;
}

export function context(db: Database.Database, input: ContextInput): MemoryRow[] {
  const limit = input.limit ?? 10;
  const parts: string[] = [];
  const args: unknown[] = [];
  if (input.projectPath) { parts.push('project_path = ?'); args.push(input.projectPath); }
  if (input.sessionId) { parts.push('session_id = ?'); args.push(input.sessionId); }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const sql = `SELECT * FROM memories_v2 ${where} ORDER BY COALESCE(updated_at, created_at) DESC LIMIT ?`;
  args.push(limit);
  return db.prepare(sql).all(...args) as MemoryRow[];
}

export interface TraceInput {
  limit?: number;
  projectPath?: string;
  sessionId?: string;
}

export function trace(db: Database.Database, input: TraceInput = {}): MemoryRow[] {
  const limit = input.limit ?? 20;
  const parts: string[] = [];
  const args: unknown[] = [];
  if (input.projectPath) { parts.push('project_path = ?'); args.push(input.projectPath); }
  if (input.sessionId) { parts.push('session_id = ?'); args.push(input.sessionId); }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const sql = `SELECT * FROM memories_v2 ${where} ORDER BY created_at DESC LIMIT ?`;
  args.push(limit);
  return db.prepare(sql).all(...args) as MemoryRow[];
}

export function getById(db: Database.Database, id: string): MemoryRow | null {
  const existing = rowById(db, id);
  if (!existing) return null;
  db.prepare(`UPDATE memories_v2 SET access_count = access_count + 1, accessed_at = ? WHERE id = ?`)
    .run(Date.now(), id);
  return rowById(db, id);
}

export interface SessionStartInput {
  sessionId: string;
  projectPath?: string;
  directory?: string;
}

export function sessionStart(db: Database.Database, input: SessionStartInput): MemoryRow {
  return save(db, {
    title: `Session start ${input.sessionId}`,
    type: 'note',
    what: input.directory ?? null as unknown as string | undefined,
    topicKey: `session/start/${input.sessionId}`,
    sessionId: input.sessionId,
    projectPath: input.projectPath,
  });
}

export interface SessionEndInput {
  sessionId: string;
  summary?: string;
  projectPath?: string;
}

export function sessionEnd(db: Database.Database, input: SessionEndInput): MemoryRow {
  return save(db, {
    title: `Session end ${input.sessionId}`,
    type: 'note',
    what: input.summary,
    topicKey: `session/end/${input.sessionId}`,
    sessionId: input.sessionId,
    projectPath: input.projectPath,
  });
}

export interface SessionSummaryInput {
  sessionId: string;
  content: string;
  title?: string;
  projectPath?: string;
}

export function sessionSummary(db: Database.Database, input: SessionSummaryInput): MemoryRow {
  return save(db, {
    title: input.title ?? `Session summary ${new Date().toISOString()}`,
    type: 'session_summary',
    what: input.content,
    topicKey: `session/${input.sessionId}`,
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    scope: 'project',
  });
}

export interface PassiveInput {
  content: string;
  sessionId?: string;
  projectPath?: string;
  source?: string;
  title?: string;
}

export function passive(db: Database.Database, input: PassiveInput): MemoryRow {
  return save(db, {
    title: input.title ?? `Passive capture ${new Date().toISOString()}`,
    type: 'note',
    what: input.content,
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    description: input.source,
  });
}

export interface MergeInput {
  from: string;
  to: string;
}

export function merge(db: Database.Database, input: MergeInput): { moved: number } {
  const info = db.prepare(`UPDATE memories_v2 SET project_path = ? WHERE project_path = ?`)
    .run(input.to, input.from);
  return { moved: info.changes };
}

export interface SuggestInput {
  title: string;
  content?: string;
  type?: MemoryType;
  limit?: number;
}

export interface SuggestHint {
  topicKey: string;
  score: number;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 3),
  );
}

export function suggest(db: Database.Database, input: SuggestInput): SuggestHint[] {
  const limit = input.limit ?? 5;
  const seed = tokenize(`${input.title} ${input.content ?? ''}`);
  if (seed.size === 0) return [];

  const parts: string[] = ['topic_key IS NOT NULL'];
  const args: unknown[] = [];
  if (input.type) { parts.push('type = ?'); args.push(input.type); }
  const rows = db.prepare(
    `SELECT DISTINCT topic_key, title, what FROM memories_v2 WHERE ${parts.join(' AND ')}`,
  ).all(...args) as Array<{ topic_key: string; title: string; what: string | null }>;

  const scored: SuggestHint[] = [];
  for (const r of rows) {
    const bag = tokenize(`${r.title} ${r.what ?? ''} ${r.topic_key}`);
    let overlap = 0;
    for (const t of seed) if (bag.has(t)) overlap++;
    if (overlap > 0) scored.push({ topicKey: r.topic_key, score: overlap });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export interface StatsInput {
  projectPath?: string;
}

export interface StatsOut {
  memoriesTotal: number;
  memoriesByType: Record<string, number>;
  recallQueries: number;
  totalCostSaved: number;
  topAccessed: Array<{ id: string; title: string; accessCount: number; costSavedUsd: number }>;
}

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

export interface VaultDump {
  version: number;
  memories: MemoryRow[];
  searches: Array<{
    id: string;
    session_id: string | null;
    memory_id: string | null;
    query: string;
    rank: number | null;
    created_at: number;
  }>;
}

export function exportVault(db: Database.Database, input: { projectPath?: string }): VaultDump {
  const parts: string[] = [];
  const args: unknown[] = [];
  if (input.projectPath) { parts.push('project_path = ?'); args.push(input.projectPath); }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const memories = db.prepare(`SELECT * FROM memories_v2 ${where}`).all(...args) as MemoryRow[];
  const searches = db.prepare(`SELECT * FROM memory_searches`).all() as VaultDump['searches'];
  return { version: 2, memories, searches };
}

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
