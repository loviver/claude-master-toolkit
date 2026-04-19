import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type {
  MemoryRow,
  RecallInput,
  RecallRow,
  ContextInput,
  TraceInput,
  SuggestInput,
  SuggestHint,
} from './types.js';

// ── FTS query sanitization ──

function sanitizeFtsQuery(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  return terms.join(' ');
}

// ── Tokenizer for suggest scoring ──

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 3),
  );
}

// ── FTS-based recall with search logging ──

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

// ── Recent context (by update time) ──

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

// ── Trace (chronological by creation) ──

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

// ── Suggest related topic keys ──

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
