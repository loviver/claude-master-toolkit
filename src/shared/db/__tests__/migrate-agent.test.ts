import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrate } from '../migrate.js';

type Col = { name: string; notnull: number; dflt_value: string | null };

describe('migrate — sessions.agent', () => {
  let tmpDir: string;
  let dbPath: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctk-migrate-agent-'));
    dbPath = join(tmpDir, 'ctk.sqlite');
    originalEnv = process.env['CTK_DB_PATH'];
    process.env['CTK_DB_PATH'] = dbPath;
  });

  afterEach(() => {
    if (originalEnv !== undefined) process.env['CTK_DB_PATH'] = originalEnv;
    else delete process.env['CTK_DB_PATH'];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds a non-null agent column defaulting to claude-code, with an index', () => {
    migrate();
    const db = new Database(dbPath);
    try {
      const col = (db.prepare(`PRAGMA table_info(sessions)`).all() as Col[]).find((c) => c.name === 'agent');
      expect(col).toMatchObject({ notnull: 1, dflt_value: "'claude-code'" });

      const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
        .get('idx_sessions_agent');
      expect(idx).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('backfills sessions synced before the column existed as claude-code', () => {
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, project_path TEXT NOT NULL, started_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL, primary_model TEXT NOT NULL DEFAULT 'unknown',
        git_branch TEXT, version TEXT, turn_count INTEGER NOT NULL DEFAULT 0,
        total_input_tokens INTEGER NOT NULL DEFAULT 0, total_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        total_cost_usd REAL NOT NULL DEFAULT 0, jsonl_file TEXT NOT NULL
      );
      INSERT INTO sessions (id, project_path, started_at, last_active_at, jsonl_file)
        VALUES ('old-1', '/p', 1, 2, '/p/old-1.jsonl');
    `);
    legacy.close();

    migrate();
    migrate(); // idempotent

    const db = new Database(dbPath);
    try {
      expect(db.prepare(`SELECT agent FROM sessions WHERE id = 'old-1'`).get()).toEqual({ agent: 'claude-code' });
    } finally {
      db.close();
    }
  });
});
