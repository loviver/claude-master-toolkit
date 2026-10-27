import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { INDEXER_SCHEMA_VERSION, assertIndexWritable, openDb } from '../db-raw.js';

let tmp: string;
let saved: string | undefined;

beforeEach(() => {
  saved = process.env['CTK_HOME'];
  tmp = mkdtempSync(join(tmpdir(), 'ctk-dbraw-'));
  process.env['CTK_HOME'] = tmp;
});
afterEach(() => {
  if (saved === undefined) delete process.env['CTK_HOME'];
  else process.env['CTK_HOME'] = saved;
  rmSync(tmp, { recursive: true, force: true });
});

describe('openDb on a fresh CTK_HOME', () => {
  it('creates the index tables so `index build` never hits "no such table"', () => {
    const db = openDb();
    expect(() => db.prepare('SELECT 1 FROM indexed_files LIMIT 1').get()).not.toThrow();
    expect(() => db.prepare('SELECT 1 FROM symbols LIMIT 1').get()).not.toThrow();
    db.close();
  });

  it('is idempotent and keeps existing rows', () => {
    const a = openDb();
    a.prepare('INSERT INTO indexed_files (project_path, file, hash, indexed_at) VALUES (?,?,?,?)').run('/p', 'a.ts', 'h', 1);
    a.close();
    const b = openDb();
    expect(b.prepare('SELECT COUNT(*) AS n FROM indexed_files').get()).toEqual({ n: 1 });
    b.close();
  });
});

describe('openDb schema v3 columns', () => {
  const cols = (db: ReturnType<typeof openDb>, t: string) =>
    (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

  it('has refs/referrers on symbols and imports on indexed_files', () => {
    const db = openDb();
    expect(cols(db, 'symbols')).toEqual(expect.arrayContaining(['refs', 'referrers']));
    expect(cols(db, 'indexed_files')).toContain('imports');
    db.close();
  });

  it('upgrades an existing v2 DB (columns missing) in place, wiping the stale index', () => {
    const a = openDb();
    a.exec('ALTER TABLE symbols DROP COLUMN refs; ALTER TABLE symbols DROP COLUMN referrers; ALTER TABLE indexed_files DROP COLUMN imports;');
    a.prepare('INSERT INTO indexed_files (project_path, file, hash, indexed_at) VALUES (?,?,?,?)').run('/p', 'a.ts', 'h', 1);
    a.pragma('user_version = 2');
    a.close();

    const b = openDb();
    expect(cols(b, 'symbols')).toEqual(expect.arrayContaining(['refs', 'referrers']));
    expect(cols(b, 'indexed_files')).toContain('imports');
    expect(b.prepare('SELECT COUNT(*) AS n FROM indexed_files').get()).toEqual({ n: 0 });
    b.close();
  });
});

describe('openDb across ctk versions sharing one DB', () => {
  const seedNewer = () => {
    const a = openDb();
    a.prepare('INSERT INTO indexed_files (project_path, file, hash, indexed_at) VALUES (?,?,?,?)').run('/p', 'a.ts', 'h', 1);
    a.pragma(`user_version = ${INDEXER_SCHEMA_VERSION + 1}`);
    a.close();
  };

  it('never wipes or downgrades an index built by a newer ctk (a stale long-lived process must not erase it)', () => {
    seedNewer();
    const b = openDb();
    expect(b.prepare('SELECT COUNT(*) AS n FROM indexed_files').get()).toEqual({ n: 1 });
    expect(b.pragma('user_version', { simple: true })).toBe(INDEXER_SCHEMA_VERSION + 1);
    b.close();
  });

  it('refuses index writes from an older ctk, so it cannot mix stale-format rows into a newer index', () => {
    seedNewer();
    const b = openDb();
    expect(() => assertIndexWritable(b)).toThrow(/newer ctk/);
    b.close();
  });

  it('allows index writes on a current index', () => {
    const db = openDb();
    expect(() => assertIndexWritable(db)).not.toThrow();
    db.close();
  });
});
