import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrate } from '../migrate.js';

describe('migrate v8 — Pandorica v2 schema', () => {
  let tmpDir: string;
  let dbPath: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctk-migrate-v8-'));
    dbPath = join(tmpDir, 'ctk.sqlite');
    originalEnv = process.env['CTK_DB_PATH'];
    process.env['CTK_DB_PATH'] = dbPath;
  });

  afterEach(() => {
    if (originalEnv !== undefined) process.env['CTK_DB_PATH'] = originalEnv;
    else delete process.env['CTK_DB_PATH'];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function tableExists(db: Database.Database, name: string): boolean {
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?`,
    ).get(name);
    return !!row;
  }

  it('creates memories_v2, memory_searches and FTS5 infra from scratch', () => {
    migrate();
    const db = new Database(dbPath);
    try {
      expect(tableExists(db, 'memories_v2')).toBe(true);
      expect(tableExists(db, 'memory_searches')).toBe(true);
      expect(tableExists(db, 'memories_fts')).toBe(true);

      const cols = db.prepare(`PRAGMA table_info(memories_v2)`).all() as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      for (const col of [
        'id', 'session_id', 'title', 'type', 'what', 'why', 'where_', 'learned',
        'topic_key', 'model', 'phase', 'tokens_input', 'tokens_output',
        'cache_hit_pct', 'cost_usd', 'access_count', 'cost_saved_usd',
        'created_at', 'updated_at', 'accessed_at',
        'scope', 'project_path', 'description', 'file_path',
      ]) {
        expect(names).toContain(col);
      }
    } finally {
      db.close();
    }
  });

  it('drops legacy memories and pandorica_memories tables', () => {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE memories (id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL,
        scope TEXT DEFAULT 'project', topic_key TEXT, content TEXT NOT NULL,
        project_path TEXT, session_id TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE pandorica_memories (id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL,
        scope TEXT DEFAULT 'project', topic_key TEXT, content TEXT NOT NULL,
        project_path TEXT, session_id TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    `);
    db.close();

    migrate();

    const db2 = new Database(dbPath);
    try {
      expect(tableExists(db2, 'memories')).toBe(false);
      expect(tableExists(db2, 'pandorica_memories')).toBe(false);
      expect(tableExists(db2, 'memories_v2')).toBe(true);
    } finally {
      db2.close();
    }
  });

  it('is idempotent on double run', () => {
    migrate();
    expect(() => migrate()).not.toThrow();

    const db = new Database(dbPath);
    try {
      expect(tableExists(db, 'memories_v2')).toBe(true);
      expect(tableExists(db, 'memories_fts')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('FTS5 trigger propagates inserts into memories_fts', () => {
    migrate();
    const db = new Database(dbPath);
    try {
      db.prepare(
        `INSERT INTO memories_v2 (id, title, type, what, why, where_, learned, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('m1', 'fts test title', 'note', 'alpha what', 'beta why', 'gamma where', 'delta learned', Date.now());

      const hits = db.prepare(
        `SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?`,
      ).all('alpha') as Array<{ rowid: number }>;
      expect(hits.length).toBe(1);

      db.prepare(`DELETE FROM memories_v2 WHERE id = ?`).run('m1');
      const afterDel = db.prepare(
        `SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?`,
      ).all('alpha') as Array<{ rowid: number }>;
      expect(afterDel.length).toBe(0);
    } finally {
      db.close();
    }
  });
});
