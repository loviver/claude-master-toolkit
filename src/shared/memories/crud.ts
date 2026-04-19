import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { MemoryRow, MemoryType, SaveInput, UpdateInput } from './types.js';

// ── Internal row lookup ──

export function rowById(db: Database.Database, id: string): MemoryRow | null {
  const row = db.prepare(`SELECT * FROM memories_v2 WHERE id = ?`).get(id) as MemoryRow | undefined;
  return row ?? null;
}

// ── Save (insert or upsert by topic key) ──

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

// ── Update existing memory ──

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

// ── Delete by ID ──

export function deleteById(db: Database.Database, id: string): boolean {
  const info = db.prepare(`DELETE FROM memories_v2 WHERE id = ?`).run(id);
  return info.changes > 0;
}

// ── Mark memory with topic key ──

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

// ── Get by ID (tracks access) ──

export function getById(db: Database.Database, id: string): MemoryRow | null {
  const existing = rowById(db, id);
  if (!existing) return null;
  db.prepare(`UPDATE memories_v2 SET access_count = access_count + 1, accessed_at = ? WHERE id = ?`)
    .run(Date.now(), id);
  return rowById(db, id);
}
