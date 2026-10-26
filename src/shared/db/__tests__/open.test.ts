import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fork } from 'child_process';
import { writeFileSync } from 'fs';
import Database from 'better-sqlite3';
import { openSqlite } from '../open.js';

const dirs: string[] = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'ctk-open-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('openSqlite', () => {
  it('applies WAL, busy_timeout, synchronous NORMAL and foreign_keys', () => {
    const db = openSqlite(join(tmp(), 'a.sqlite'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  it('creates missing parent directories', () => {
    const p = join(tmp(), 'deep', 'nested', 'a.sqlite');
    const db = openSqlite(p);
    db.exec('CREATE TABLE t (v INTEGER)');
    db.close();
  });

  it('two processes writing the same DB concurrently lose no rows and never hit SQLITE_BUSY', async () => {
    const dir = tmp();
    const dbPath = join(dir, 'shared.sqlite');
    const seed = openSqlite(dbPath);
    seed.exec('CREATE TABLE t (who TEXT, n INTEGER)');
    seed.close();

    const N = 300;
    const worker = join(dir, 'worker.mjs');
    const openModule = new URL('../open.ts', import.meta.url).pathname;
    writeFileSync(
      worker,
      `
      import { openSqlite } from ${JSON.stringify(openModule)};
      const [path, who, n] = process.argv.slice(2);
      const db = openSqlite(path);
      const ins = db.prepare('INSERT INTO t VALUES (?, ?)');
      try {
        for (let i = 0; i < Number(n); i++) ins.run(who, i);
        process.exit(0);
      } catch (e) { console.error(String(e)); process.exit(1); }
      `,
    );

    const run = (who: string) =>
      new Promise<number>((resolve) => {
        const c = fork(worker, [dbPath, who, String(N)], {
          execArgv: ['--import', 'tsx'],
          stdio: 'pipe',
        });
        let err = '';
        c.stderr?.on('data', (d) => (err += d));
        c.on('exit', (code) => {
          if (code !== 0) console.error(err);
          resolve(code ?? 1);
        });
      });

    const codes = await Promise.all([run('claude'), run('codex')]);
    expect(codes).toEqual([0, 0]);

    const check = new Database(dbPath, { readonly: true });
    const rows = check.prepare('SELECT COUNT(*) AS c FROM t').get() as { c: number };
    expect(rows.c).toBe(2 * N);
    check.close();
  }, 30_000);
});
