/**
 * GET /api/sessions/:id/git-stats shells out to git with the session's
 * project_path, which comes from parsed JSONL. The path must reach git as a
 * single argv entry, never through a shell.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import type { FastifyInstance } from 'fastify';
import { migrate } from '../../shared/db/migrate';
import { closeDb } from '../../shared/db/db';
import { buildApp } from '../index';

const NOW = Date.now();

function insertSession(dbPath: string, id: string, projectPath: string): void {
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO sessions (id, project_path, started_at, last_active_at, jsonl_file)
     VALUES (?, ?, ?, ?, '/tmp/ctk-git-stats.jsonl')`,
  ).run(id, projectPath, NOW - 60_000, NOW);
  db.close();
}

describe('GET /api/sessions/:id/git-stats', () => {
  let dir: string;
  let marker: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ctk-git-stats-'));
    const dbPath = join(dir, 'ctk.sqlite');
    process.env.CTK_DB_PATH = dbPath;
    closeDb();
    migrate();

    // A directory name that breaks out of the double-quoted shell argument.
    marker = join(dir, 'pwned');
    process.env.CTK_PWN_MARKER = marker;
    const hostile = join(dir, 'a";touch "$CTK_PWN_MARKER";"');
    mkdirSync(hostile);
    insertSession(dbPath, 'sess-hostile', hostile);

    // A real repo: one commit inside the session window (+1 line) plus an
    // uncommitted change (+2 lines), both on the same file.
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
        stdio: 'pipe',
      });
    git('init', '-q');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'init');
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n');
    insertSession(dbPath, 'sess-repo', repo);

    app = await buildApp({ serveStatic: false });
  });

  afterAll(async () => {
    await app?.close();
    closeDb();
    delete process.env.CTK_DB_PATH;
    delete process.env.CTK_PWN_MARKER;
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not execute shell metacharacters embedded in project_path', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/sess-hostile/git-stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false });
    expect(existsSync(marker)).toBe(false);
  });

  it('still counts insertions in a real repository', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/sess-repo/git-stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ insertions: 3, deletions: 0, filesChanged: 1, available: true });
  });
});
