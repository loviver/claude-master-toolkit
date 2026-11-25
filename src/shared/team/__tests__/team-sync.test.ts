import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { migrate } from '../../db/migrate.js';
import { openMemDb, save, recall, update, getById } from '../../memories/v2.js';
import { createGitAdapter, type OpenPr } from '../git-adapter.js';
import { promote, pull } from '../service.js';
import { getTeamRepo, setTeamRepo } from '../config.js';
import { git, makeRepo, tmp } from './helpers.js';

describe('team sync over git', () => {
  let root: string;
  let remote: string;
  let project: string;
  let prs: Array<{ branch: string; base: string; title: string; body: string }>;
  let originalDb: string | undefined;

  const openPr: OpenPr = (pr) => { prs.push(pr); return `https://example.test/pr/${prs.length}`; };

  /** Each "machine" is its own vault plus its own clone of the knowledge repo. */
  function machine(name: string) {
    const clone = join(root, `clone-${name}`);
    if (!existsSync(clone)) {
      git(root, 'clone', '-q', remote, clone);
      git(clone, 'config', 'user.email', `${name}@example.com`);
      git(clone, 'config', 'user.name', name);
      git(clone, 'config', 'commit.gpgsign', 'false');
    }
    process.env['CTK_DB_PATH'] = join(root, `${name}.sqlite`);
    migrate();
    return { db: openMemDb(), port: createGitAdapter({ repoPath: clone, openPr }), clone };
  }

  /** Simulates the reviewer merging the proposed branch on the remote. */
  function merge(branch: string) {
    const reviewer = join(root, 'reviewer');
    if (!existsSync(reviewer)) {
      git(root, 'clone', '-q', remote, reviewer);
      git(reviewer, 'config', 'user.email', 'r@example.com');
      git(reviewer, 'config', 'user.name', 'r');
      git(reviewer, 'config', 'commit.gpgsign', 'false');
    }
    git(reviewer, 'fetch', '-q', 'origin');
    git(reviewer, 'merge', '-q', '--no-ff', '-m', 'merge', `origin/${branch}`);
    git(reviewer, 'push', '-q', 'origin', 'main');
  }

  function seed(db: ReturnType<typeof openMemDb>, extra: Record<string, unknown> = {}) {
    return save(db, {
      title: 'Fixed duplicated total',
      type: 'bugfix',
      what: 'rounding happened twice',
      projectPath: project,
      ticket: 'DEV-1',
      author: 'dev@example.com',
      commitSha: 'abc1234',
      gitBranch: 'feat/DEV-1-x',
      sessionId: 'secret-session',
      costUsd: 3,
      ...extra,
    });
  }

  beforeEach(() => {
    originalDb = process.env['CTK_DB_PATH'];
    root = tmp('ctk-team-');
    prs = [];
    remote = join(root, 'knowledge.git');
    git(root, 'init', '-q', '--bare', '-b', 'main', remote);
    const seedDir = join(root, 'seed');
    mkdirSync(seedDir);
    makeRepo(seedDir, 'main');
    git(seedDir, 'push', '-q', remote, 'main');
    project = join(root, 'my-app');
    mkdirSync(project);
    makeRepo(project, 'feat/DEV-1-x');
    git(project, 'remote', 'add', 'origin', 'git@github.com:acme/shop-api.git');
  });

  afterEach(() => {
    if (originalDb !== undefined) process.env['CTK_DB_PATH'] = originalDb;
    else delete process.env['CTK_DB_PATH'];
    rmSync(root, { recursive: true, force: true });
  });

  it('promote opens a PR with one file per memory and leaves the local scope alone', () => {
    const a = machine('a');
    const row = seed(a.db);
    const result = promote(a.db, a.port, { ids: [row.id] });

    expect(result.url).toBe('https://example.test/pr/1');
    expect(prs[0]).toMatchObject({ base: 'main', branch: result.branch });
    expect(prs[0]!.title).toContain('DEV-1');
    expect(prs[0]!.body).toContain('## Resumen');
    const path = `memories/shop-api/DEV-1/${row.id}.json`;
    const file = JSON.parse(git(a.clone, 'show', `origin/${result.branch}:${path}`));
    expect(file).toMatchObject({
      version: 1, id: row.id, ticket: 'DEV-1', author: 'dev@example.com', commit: 'abc1234', branch: 'feat/DEV-1-x',
    });
    expect(JSON.stringify(file)).not.toContain('secret-session');
    expect(file).not.toHaveProperty('costUsd');
    expect(getById(a.db, row.id)!.scope).toBe('project');
    // The user's checkout of the knowledge repo is never touched.
    expect(git(a.clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(git(a.clone, 'status', '--porcelain')).toBe('');
    a.db.close();
  });

  it('team members see a memory only after the PR is merged, and pull is idempotent', () => {
    const a = machine('a');
    const row = seed(a.db);
    const { branch } = promote(a.db, a.port, { ids: [row.id] });
    a.db.close();

    const b = machine('b');
    expect(pull(b.db, b.port).imported).toBe(0);
    expect(recall(b.db, { query: '', ticket: 'DEV-1' })).toEqual([]);

    merge(branch);
    expect(pull(b.db, b.port)).toMatchObject({ imported: 1, updated: 0, invalid: [] });
    const found = recall(b.db, { query: 'rounding', ticket: 'DEV-1' });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: row.id, scope: 'team', author: 'dev@example.com' });
    expect(pull(b.db, b.port)).toMatchObject({ upToDate: true, imported: 0 });
    b.db.close();
  });

  it('marks the author copy as team on pull and never overwrites newer local edits', () => {
    const a = machine('a');
    const kept = seed(a.db);
    const edited = seed(a.db, { title: 'second' });
    const { branch } = promote(a.db, a.port, { ids: [kept.id, edited.id] });
    merge(branch);
    a.db.prepare('UPDATE memories_v2 SET updated_at = updated_at + 1000, what = ? WHERE id = ?').run('local edit', edited.id);

    pull(a.db, a.port);

    expect(getById(a.db, kept.id)).toMatchObject({ scope: 'team', project_path: project });
    expect(getById(a.db, edited.id)).toMatchObject({ scope: 'project', what: 'local edit' });
    a.db.close();
  });

  it('applies a newer team version over an older imported one', () => {
    const a = machine('a');
    const row = seed(a.db);
    merge(promote(a.db, a.port, { ids: [row.id] }).branch);
    const b = machine('b');
    pull(b.db, b.port);

    process.env['CTK_DB_PATH'] = join(root, 'a.sqlite');
    update(a.db, row.id, { what: 'better explanation' });
    merge(promote(a.db, a.port, { ids: [row.id] }).branch);

    expect(pull(b.db, b.port)).toMatchObject({ imported: 0, updated: 1 });
    expect(getById(b.db, row.id)!.what).toBe('better explanation');
    a.db.close();
    b.db.close();
  });

  it('blocks promote on a secret, naming the field, and pushes nothing', () => {
    const a = machine('a');
    const clean = seed(a.db);
    const dirty = seed(a.db, { title: 'leak', learned: ['ghp_', 'c'.repeat(36)].join('') });
    expect(() => promote(a.db, a.port, { ids: [clean.id, dirty.id] })).toThrow(/learned.*github-token/);
    expect(prs).toEqual([]);
    expect(git(a.clone, 'ls-remote', '--heads', 'origin')).not.toContain('ctk/');
    a.db.close();
  });

  it('refuses unknown ids and session summaries', () => {
    const a = machine('a');
    expect(() => promote(a.db, a.port, { ids: ['nope'] })).toThrow(/not found/);
    const summary = seed(a.db, { type: 'session_summary' });
    expect(() => promote(a.db, a.port, { ids: [summary.id] })).toThrow(/session_summary/);
    a.db.close();
  });

  it('skips invalid files from the repo without importing them', () => {
    const a = machine('a');
    const dir = join(a.clone, 'memories', 'x', 'DEV-9');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.json'), '{"version":1,"id":"not-a-uuid"}');
    git(a.clone, 'add', '-A');
    git(a.clone, 'commit', '-q', '-m', 'bad');
    git(a.clone, 'push', '-q', 'origin', 'main');

    const result = pull(a.db, a.port);
    expect(result.imported).toBe(0);
    expect(result.invalid).toEqual(['memories/x/DEV-9/bad.json']);
    a.db.close();
  });

  it('keeps local recall working when the remote is unreachable', () => {
    const a = machine('a');
    seed(a.db);
    rmSync(remote, { recursive: true, force: true });
    expect(() => pull(a.db, a.port)).toThrow(/fetch/);
    expect(recall(a.db, { query: 'rounding', ticket: 'DEV-1' })).toHaveLength(1);
    a.db.close();
  });

  it('stores the knowledge repo path, cloning when given a remote', () => {
    const originalHome = process.env['CTK_HOME'];
    const originalRepo = process.env['CTK_TEAM_REPO'];
    delete process.env['CTK_TEAM_REPO'];
    process.env['CTK_HOME'] = join(root, 'home');
    const a = machine('a');
    try {
      expect(getTeamRepo(a.db)).toBeUndefined();
      expect(setTeamRepo(a.db, a.clone)).toBe(a.clone);
      expect(getTeamRepo(a.db)).toBe(a.clone);
      const cloned = setTeamRepo(a.db, `file://${remote}`);
      expect(existsSync(join(cloned, '.git'))).toBe(true);
      expect(readFileSync(join(cloned, 'README.md'), 'utf-8')).toBe('x\n');
      expect(() => setTeamRepo(a.db, join(root, 'missing'))).toThrow(/not a git/);
    } finally {
      a.db.close();
      if (originalHome !== undefined) process.env['CTK_HOME'] = originalHome; else delete process.env['CTK_HOME'];
      if (originalRepo !== undefined) process.env['CTK_TEAM_REPO'] = originalRepo;
    }
  });
});
