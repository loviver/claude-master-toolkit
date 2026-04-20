import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { migrate } from '../migrate';

describe('composite index (session_id, timestamp)', () => {
  let dir: string;
  let dbPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ctk-idx-'));
    dbPath = join(dir, 'ctk.sqlite');
    process.env.CTK_DB_PATH = dbPath;
    migrate();
  });

  afterAll(() => {
    delete process.env.CTK_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('existe idx_token_events_session_timestamp', () => {
    const db = new Database(dbPath);
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_token_events_session_timestamp'`,
    ).get();
    db.close();
    expect(row).toBeTruthy();
  });

  it('EXPLAIN QUERY PLAN usa índice composite en filtro + ORDER BY', () => {
    const db = new Database(dbPath);
    const plan = db.prepare(
      `EXPLAIN QUERY PLAN SELECT * FROM token_events WHERE session_id = ? ORDER BY timestamp`,
    ).all('x') as Array<{ detail: string }>;
    db.close();
    const joined = plan.map((r) => r.detail).join(' | ');
    expect(joined).toMatch(/idx_token_events_session_timestamp/);
  });
});
