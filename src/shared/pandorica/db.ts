import type Database from 'better-sqlite3';
import { openDb } from '../indexer/db-raw.js';
import { randomUUID } from 'crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pandorica_memories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'project',
  topic_key TEXT,
  content TEXT NOT NULL,
  project_path TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pandorica_topic ON pandorica_memories(topic_key);
CREATE INDEX IF NOT EXISTS idx_pandorica_project ON pandorica_memories(project_path);
CREATE INDEX IF NOT EXISTS idx_pandorica_created ON pandorica_memories(created_at);
CREATE INDEX IF NOT EXISTS idx_pandorica_type ON pandorica_memories(type);
`;

export function openPandoricaDb(): Database.Database {
  const db = openDb();
  db.exec(SCHEMA);
  return db;
}

export type PandoricaType =
  | 'bugfix'
  | 'decision'
  | 'architecture'
  | 'discovery'
  | 'pattern'
  | 'config'
  | 'preference'
  | 'session_summary';

export type PandoricaScope = 'project' | 'personal';

export interface MemoryRow {
  id: string;
  title: string;
  type: PandoricaType;
  scope: PandoricaScope;
  topic_key: string | null;
  content: string;
  project_path: string | null;
  session_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface SaveInput {
  title: string;
  type: PandoricaType;
  scope?: PandoricaScope;
  topicKey?: string;
  content: string;
  projectPath?: string;
  sessionId?: string;
}

export function save(db: Database.Database, input: SaveInput): MemoryRow {
  const now = Date.now();
  const scope = input.scope ?? 'project';

  if (input.topicKey) {
    const existing = db
      .prepare('SELECT * FROM pandorica_memories WHERE topic_key = ? AND scope = ?')
      .get(input.topicKey, scope) as MemoryRow | undefined;
    if (existing) {
      db.prepare(
        `UPDATE pandorica_memories
         SET title = ?, type = ?, content = ?, project_path = ?, session_id = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        input.title,
        input.type,
        input.content,
        input.projectPath ?? existing.project_path,
        input.sessionId ?? existing.session_id,
        now,
        existing.id,
      );
      return { ...existing, title: input.title, type: input.type, content: input.content, updated_at: now };
    }
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO pandorica_memories
     (id, title, type, scope, topic_key, content, project_path, session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.type,
    scope,
    input.topicKey ?? null,
    input.content,
    input.projectPath ?? null,
    input.sessionId ?? null,
    now,
    now,
  );
  return {
    id,
    title: input.title,
    type: input.type,
    scope,
    topic_key: input.topicKey ?? null,
    content: input.content,
    project_path: input.projectPath ?? null,
    session_id: input.sessionId ?? null,
    created_at: now,
    updated_at: now,
  };
}

export interface SearchOpts {
  query: string;
  limit?: number;
  type?: PandoricaType;
  scope?: PandoricaScope;
  projectPath?: string;
}

export function search(db: Database.Database, opts: SearchOpts): MemoryRow[] {
  const limit = opts.limit ?? 20;
  const parts: string[] = ['(title LIKE ? OR content LIKE ? OR topic_key LIKE ?)'];
  const like = `%${opts.query}%`;
  const args: unknown[] = [like, like, like];
  if (opts.type) {
    parts.push('type = ?');
    args.push(opts.type);
  }
  if (opts.scope) {
    parts.push('scope = ?');
    args.push(opts.scope);
  }
  if (opts.projectPath) {
    parts.push('project_path = ?');
    args.push(opts.projectPath);
  }
  const sql = `SELECT * FROM pandorica_memories WHERE ${parts.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`;
  args.push(limit);
  return db.prepare(sql).all(...args) as MemoryRow[];
}

export interface ContextOpts {
  projectPath?: string;
  sessionId?: string;
  limit?: number;
}

export function context(db: Database.Database, opts: ContextOpts): MemoryRow[] {
  const limit = opts.limit ?? 10;
  const parts: string[] = [];
  const args: unknown[] = [];
  if (opts.projectPath) {
    parts.push('project_path = ?');
    args.push(opts.projectPath);
  }
  if (opts.sessionId) {
    parts.push('session_id = ?');
    args.push(opts.sessionId);
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const sql = `SELECT * FROM pandorica_memories ${where} ORDER BY updated_at DESC LIMIT ?`;
  args.push(limit);
  return db.prepare(sql).all(...args) as MemoryRow[];
}

export function getById(db: Database.Database, id: string): MemoryRow | null {
  const row = db.prepare('SELECT * FROM pandorica_memories WHERE id = ?').get(id) as MemoryRow | undefined;
  return row ?? null;
}

export function deleteById(db: Database.Database, id: string): boolean {
  const info = db.prepare('DELETE FROM pandorica_memories WHERE id = ?').run(id);
  return info.changes > 0;
}

export function recent(db: Database.Database, projectPath: string | undefined, limit = 10): MemoryRow[] {
  if (projectPath) {
    return db
      .prepare('SELECT * FROM pandorica_memories WHERE project_path = ? ORDER BY created_at DESC LIMIT ?')
      .all(projectPath, limit) as MemoryRow[];
  }
  return db
    .prepare('SELECT * FROM pandorica_memories ORDER BY created_at DESC LIMIT ?')
    .all(limit) as MemoryRow[];
}
