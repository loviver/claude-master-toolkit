import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import type { FastifyInstance } from 'fastify';
import { migrate } from '../../shared/db/migrate';
import { closeDb } from '../../shared/db/db';
import { buildApp } from '../index';
import type {
  CodeGraphDTO,
  CodeGraphFileDTO,
  CodeGraphProjectDTO,
  CodeGraphRevisionDTO,
  CodeGraphSourceDTO,
} from '../../shared/api-types';

const PROJECT = '/tmp/ctk-code-graph-project-does-not-exist';

describe('code graph API', () => {
  let dir: string;
  let dbPath: string;
  let app: FastifyInstance;

  function write(fn: (db: Database.Database) => void): void {
    const db = new Database(dbPath);
    try { fn(db); } finally { db.close(); }
  }

  function sym(db: Database.Database, file: string, symbol: string, deps: string[] = []): void {
    db.prepare(
      `INSERT INTO symbols (project_path, file, symbol, kind, signature, start_line, end_line, exported,
         deps, callers, refs, tokens_estimate, content_hash, updated_at)
       VALUES (?, ?, ?, 'function', ?, 1, 5, 1, ?, '[]', '[]', 0, 'h', 0)`,
    ).run(PROJECT, file, symbol, `${symbol}()`, JSON.stringify(deps));
  }

  function indexed(db: Database.Database, file: string, at: number): void {
    db.prepare(
      `INSERT OR REPLACE INTO indexed_files (project_path, file, hash, indexed_at) VALUES (?, ?, 'h', ?)`,
    ).run(PROJECT, file, at);
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ctk-code-graph-'));
    dbPath = join(dir, 'ctk.sqlite');
    process.env.CTK_DB_PATH = dbPath;
    closeDb();
    migrate();
    write((db) => {
      sym(db, 'src/core.ts', 'core');
      sym(db, 'src/app/a.ts', 'useA', ['src/core.ts::core']);
      indexed(db, 'src/core.ts', 100);
      indexed(db, 'src/app/a.ts', 100);
    });
    app = await buildApp({ serveStatic: false });
  });

  afterAll(async () => {
    await app?.close();
    closeDb();
    delete process.env.CTK_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (url: string) => app.inject({ method: 'GET', url });

  it('lists indexed projects', async () => {
    const res = await get('/api/code-graph/projects');
    expect(res.statusCode).toBe(200);
    expect(res.json<CodeGraphProjectDTO[]>()).toEqual([
      { projectPath: PROJECT, symbols: 2, files: 2, indexedAt: 100 },
    ]);
  });

  it('returns the graph of a level with its revision', async () => {
    const res = await get(`/api/code-graph?project=${encodeURIComponent(PROJECT)}&level=file`);
    expect(res.statusCode).toBe(200);
    const body = res.json<CodeGraphDTO>();
    expect(body.project).toBe(PROJECT);
    expect(body.level).toBe('file');
    expect(body.revision).toMatch(/\S/);
    expect(body.nodes.map((n) => n.id).sort()).toEqual(['src/app/a.ts', 'src/core.ts']);
    expect(body.links).toEqual([{ source: 'src/app/a.ts', target: 'src/core.ts', type: 'call', weight: 1 }]);
  });

  it('defaults to the module level', async () => {
    const res = await get(`/api/code-graph?project=${encodeURIComponent(PROJECT)}`);
    expect(res.json<CodeGraphDTO>().level).toBe('module');
  });

  it('serves a fresh graph once the index changes (cache keyed by revision)', async () => {
    const url = `/api/code-graph?project=${encodeURIComponent(PROJECT)}&level=symbol`;
    const before = (await get(url)).json<CodeGraphDTO>();
    const rev = (await get(`/api/code-graph/revision?project=${encodeURIComponent(PROJECT)}`)).json<CodeGraphRevisionDTO>();
    expect(rev).toEqual({ project: PROJECT, revision: before.revision });

    write((db) => {
      sym(db, 'src/app/b.ts', 'useB', ['src/core.ts::core']);
      indexed(db, 'src/app/b.ts', 200);
    });

    const after = (await get(url)).json<CodeGraphDTO>();
    expect(after.revision).not.toBe(before.revision);
    expect(after.nodes.map((n) => n.id)).toContain('src/app/b.ts::useB');
  });

  it('rejects a project that is not indexed with 404', async () => {
    const res = await get('/api/code-graph?project=%2Fnot%2Findexed');
    expect(res.statusCode).toBe(404);
  });

  it('rejects a missing project or an unknown level with 400', async () => {
    expect((await get('/api/code-graph')).statusCode).toBe(400);
    expect((await get(`/api/code-graph?project=${encodeURIComponent(PROJECT)}&level=galaxy`)).statusCode).toBe(400);
    expect((await get(`/api/code-graph?project=${encodeURIComponent(PROJECT)}&depth=-1`)).statusCode).toBe(400);
  });

  it('reports risk as 422 when the project has no git checkout, instead of a 500', async () => {
    const res = await get(`/api/code-graph/risk?project=${encodeURIComponent(PROJECT)}&level=file`);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toHaveProperty('error');
  });
});

describe('code graph explorer API (files + source)', () => {
  let dir: string;
  let repo: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ctk-code-graph-src-'));
    repo = join(dir, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src/core.ts'), 'export function core() {\n  return 1;\n}\n');
    writeFileSync(join(dir, 'secret.txt'), 'outside');
    symlinkSync(join(dir, 'secret.txt'), join(repo, 'src/leak.ts'));

    process.env.CTK_DB_PATH = join(dir, 'ctk.sqlite');
    closeDb();
    migrate();
    const db = new Database(process.env.CTK_DB_PATH);
    try {
      const ins = db.prepare(
        `INSERT INTO symbols (project_path, file, symbol, kind, signature, start_line, end_line, exported,
           deps, callers, refs, tokens_estimate, content_hash, updated_at)
         VALUES (?, ?, ?, 'function', '', 1, 3, 1, '[]', '[]', '[]', 0, 'h', 0)`,
      );
      ins.run(repo, 'src/core.ts', 'core');
      ins.run(repo, 'src/leak.ts', 'leak');
      const file = db.prepare(`INSERT INTO indexed_files (project_path, file, hash, indexed_at) VALUES (?, ?, 'h', ?)`);
      file.run(repo, 'src/core.ts', 100);
      file.run(repo, 'src/leak.ts', 100);
      file.run(repo, 'src/gone.ts', 100);
    } finally {
      db.close();
    }
    app = await buildApp({ serveStatic: false });
  });

  afterAll(async () => {
    await app?.close();
    closeDb();
    delete process.env.CTK_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (path: string, query: Record<string, string>) =>
    app.inject({ method: 'GET', url: `/api/code-graph/${path}?${new URLSearchParams(query)}` });

  it('lists indexed files with their symbol counts', async () => {
    const res = await get('files', { project: repo });
    expect(res.statusCode).toBe(200);
    expect(res.json<CodeGraphFileDTO[]>()).toEqual([
      { file: 'src/core.ts', symbols: 1, indexedAt: 100 },
      { file: 'src/gone.ts', symbols: 0, indexedAt: 100 },
      { file: 'src/leak.ts', symbols: 1, indexedAt: 100 },
    ]);
  });

  it('serves an indexed file with its grammar and symbol outline', async () => {
    const res = await get('source', { project: repo, file: 'src/core.ts' });
    expect(res.statusCode).toBe(200);
    expect(res.json<CodeGraphSourceDTO>()).toEqual({
      file: 'src/core.ts',
      language: 'typescript',
      content: 'export function core() {\n  return 1;\n}\n',
      outline: [{ id: 'src/core.ts::core', symbol: 'core', kind: 'function', startLine: 1, endLine: 3 }],
    });
  });

  it('refuses paths the index does not list, including traversal', async () => {
    expect((await get('source', { project: repo, file: '../secret.txt' })).statusCode).toBe(404);
    expect((await get('source', { project: repo, file: 'src/other.ts' })).statusCode).toBe(404);
    expect((await get('source', { project: repo })).statusCode).toBe(400);
  });

  it('refuses an indexed symlink that resolves outside the project', async () => {
    expect((await get('source', { project: repo, file: 'src/leak.ts' })).statusCode).toBe(403);
  });

  it('reports an indexed file deleted from disk as 404', async () => {
    const res = await get('source', { project: repo, file: 'src/gone.ts' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toMatch(/no longer on disk/);
  });
});
