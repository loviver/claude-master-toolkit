import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openDb } from '../db-raw.js';

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
