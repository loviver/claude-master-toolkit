import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  buildCodeGraph,
  containerId,
  graphRevision,
  indexedProjects,
  projectRisk,
} from '../code-graph.js';

const PROJECT = '/proj';
let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE symbols (
    project_path TEXT, file TEXT, symbol TEXT, kind TEXT, signature TEXT,
    start_line INTEGER, end_line INTEGER, exported INTEGER,
    deps TEXT, callers TEXT, refs TEXT, referrers TEXT, dep_sites TEXT, tokens_estimate INTEGER
  )`);
  db.exec(`CREATE TABLE indexed_files (
    project_path TEXT, file TEXT, hash TEXT, indexed_at INTEGER, imports TEXT
  )`);
});

afterEach(() => db.close());

function sym(
  file: string,
  symbol: string,
  opts: { deps?: string[]; refs?: string[]; kind?: string; exported?: boolean; project?: string } = {},
): void {
  db.prepare(
    `INSERT INTO symbols (project_path, file, symbol, kind, signature, start_line, end_line, exported, deps, callers, refs, tokens_estimate)
     VALUES (?, ?, ?, ?, ?, 3, 9, ?, ?, '[]', ?, 0)`,
  ).run(
    opts.project ?? PROJECT, file, symbol, opts.kind ?? 'function', `${symbol}()`, opts.exported === false ? 0 : 1,
    JSON.stringify(opts.deps ?? []), JSON.stringify(opts.refs ?? []),
  );
}

function file(path: string, indexedAt: number, project = PROJECT): void {
  db.prepare(`INSERT INTO indexed_files (project_path, file, hash, indexed_at) VALUES (?, ?, 'h', ?)`)
    .run(project, path, indexedAt);
}

/** core ← useA, core ← useB (calls), useB ← leaf (type ref), plus one unresolved bare call. */
function seed(): void {
  sym('src/lib/core.ts', 'core');
  sym('src/lib/core.ts', 'helper', { exported: false });
  sym('src/feat/a.ts', 'useA', { deps: ['src/lib/core.ts::core', 'dynamicThing'] });
  sym('src/feat/b.ts', 'useB', { deps: ['src/lib/core.ts::core', 'src/lib/core.ts::helper'] });
  sym('src/feat/c.ts', 'leaf', { refs: ['src/feat/b.ts::useB'], kind: 'type' });
  file('src/lib/core.ts', 100);
  file('src/feat/a.ts', 200);
  file('src/feat/b.ts', 300);
  file('src/feat/c.ts', 400);
}

const ids = (g: ReturnType<typeof buildCodeGraph>) => g.nodes.map((n) => n.id).sort();
const linkKeys = (g: ReturnType<typeof buildCodeGraph>) =>
  g.links.map((l) => `${l.source}>${l.target}:${l.type}:${l.weight}`).sort();

describe('containerId', () => {
  it('maps a symbol to its node id at each level', () => {
    expect(containerId('symbol', 'src/a/b.ts', 'run')).toBe('src/a/b.ts::run');
    expect(containerId('file', 'src/a/b.ts', 'run')).toBe('src/a/b.ts');
    expect(containerId('module', 'src/a/b.ts', 'run')).toBe('src/a');
    expect(containerId('module', 'index.ts', 'run')).toBe('.');
  });
});

describe('buildCodeGraph — symbol level', () => {
  it('emits one node per symbol and only resolved, in-index edges', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol' });
    expect(ids(g)).toEqual([
      'src/feat/a.ts::useA',
      'src/feat/b.ts::useB',
      'src/feat/c.ts::leaf',
      'src/lib/core.ts::core',
      'src/lib/core.ts::helper',
    ]);
    expect(linkKeys(g)).toEqual([
      'src/feat/a.ts::useA>src/lib/core.ts::core:call:1',
      'src/feat/b.ts::useB>src/lib/core.ts::core:call:1',
      'src/feat/b.ts::useB>src/lib/core.ts::helper:call:1',
      'src/feat/c.ts::leaf>src/feat/b.ts::useB:ref:1',
    ]);
    expect(g.stats.unresolved).toBe(1);
    expect(g.stats.truncated).toBe(false);
  });

  it('carries the inspector fields off the index', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol' });
    const helper = g.nodes.find((n) => n.id === 'src/lib/core.ts::helper')!;
    expect(helper).toMatchObject({
      label: 'helper',
      kind: 'function',
      file: 'src/lib/core.ts',
      group: 'src/lib',
      exported: false,
      signature: 'helper()',
      startLine: 3,
      endLine: 9,
      size: 1,
      indexedAt: 100,
    });
  });

  it('normalizes rank so the most depended-on node is 1', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol' });
    const top = [...g.nodes].sort((a, b) => b.rank - a.rank)[0];
    expect(top.id).toBe('src/lib/core.ts::core');
    expect(top.rank).toBe(1);
    expect(g.nodes.every((n) => n.rank > 0 && n.rank <= 1)).toBe(true);
  });

  it('ignores other projects', () => {
    seed();
    sym('src/x.ts', 'foreign', { project: '/other' });
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol' });
    expect(ids(g)).not.toContain('src/x.ts::foreign');
  });
});

describe('buildCodeGraph — aggregated levels', () => {
  it('file level folds symbol edges into weighted file edges, dropping self-loops', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'file' });
    expect(ids(g)).toEqual(['src/feat/a.ts', 'src/feat/b.ts', 'src/feat/c.ts', 'src/lib/core.ts']);
    expect(linkKeys(g)).toEqual([
      'src/feat/a.ts>src/lib/core.ts:call:1',
      'src/feat/b.ts>src/lib/core.ts:call:2',
      'src/feat/c.ts>src/feat/b.ts:ref:1',
    ]);
    const core = g.nodes.find((n) => n.id === 'src/lib/core.ts')!;
    expect(core).toMatchObject({ kind: 'file', label: 'core.ts', size: 2, exported: true, file: 'src/lib/core.ts' });
  });

  it('module level groups by directory and keeps the newest indexedAt', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'module' });
    expect(ids(g)).toEqual(['src/feat', 'src/lib']);
    // the useB → leaf ref is internal to src/feat, so it disappears
    expect(linkKeys(g)).toEqual(['src/feat>src/lib:call:3']);
    const feat = g.nodes.find((n) => n.id === 'src/feat')!;
    expect(feat).toMatchObject({ kind: 'module', label: 'feat', size: 3, indexedAt: 400, file: null });
  });
});

describe('buildCodeGraph — scope, focus, limit', () => {
  it('scope keeps only files under a path prefix', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'file', scope: 'src/feat' });
    expect(ids(g)).toEqual(['src/feat/a.ts', 'src/feat/b.ts', 'src/feat/c.ts']);
    expect(linkKeys(g)).toEqual(['src/feat/c.ts>src/feat/b.ts:ref:1']);
  });

  it('scope matches whole path segments, not raw string prefixes', () => {
    seed();
    sym('src/featured/z.ts', 'z');
    const g = buildCodeGraph(db, PROJECT, { level: 'file', scope: 'src/feat' });
    expect(ids(g)).not.toContain('src/featured/z.ts');
  });

  it('focus returns the neighbourhood within depth, walking both directions', () => {
    seed();
    const one = buildCodeGraph(db, PROJECT, { level: 'symbol', focus: 'src/feat/b.ts::useB', depth: 1 });
    expect(ids(one)).toEqual([
      'src/feat/b.ts::useB',
      'src/feat/c.ts::leaf',
      'src/lib/core.ts::core',
      'src/lib/core.ts::helper',
    ]);
    const two = buildCodeGraph(db, PROJECT, { level: 'symbol', focus: 'src/feat/b.ts::useB', depth: 2 });
    expect(ids(two)).toContain('src/feat/a.ts::useA');
  });

  it('an unknown focus yields an empty graph rather than the whole repo', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol', focus: 'nope::nothing' });
    expect(g.nodes).toEqual([]);
    expect(g.links).toEqual([]);
  });

  it('limit keeps the top-ranked nodes, drops dangling links and reports truncation', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol', limit: 2 });
    expect(g.nodes).toHaveLength(2);
    expect(g.nodes.map((n) => n.id)).toContain('src/lib/core.ts::core');
    const kept = new Set(g.nodes.map((n) => n.id));
    expect(g.links.every((l) => kept.has(l.source) && kept.has(l.target))).toBe(true);
    expect(g.stats).toMatchObject({ totalNodes: 5, truncated: true });
  });

  it('the focus node survives the limit even when it ranks low', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol', focus: 'src/feat/c.ts::leaf', depth: 2, limit: 1 });
    expect(g.nodes.map((n) => n.id)).toEqual(['src/feat/c.ts::leaf']);
  });

  it('an empty index is an empty graph', () => {
    const g = buildCodeGraph(db, PROJECT, { level: 'module' });
    expect(g).toMatchObject({ nodes: [], links: [], stats: { totalNodes: 0, truncated: false } });
  });
});

describe('graphRevision', () => {
  it('changes when a file is reindexed or a symbol appears', () => {
    seed();
    const before = graphRevision(db, PROJECT);
    expect(graphRevision(db, PROJECT)).toBe(before);
    db.prepare(`UPDATE indexed_files SET indexed_at = 999 WHERE file = 'src/feat/a.ts'`).run();
    const afterReindex = graphRevision(db, PROJECT);
    expect(afterReindex).not.toBe(before);
    sym('src/feat/a.ts', 'brandNew');
    expect(graphRevision(db, PROJECT)).not.toBe(afterReindex);
  });
});

describe('indexedProjects', () => {
  it('lists each indexed project with its size, biggest first', () => {
    seed();
    sym('x.ts', 'only', { project: '/small' });
    file('x.ts', 50, '/small');
    expect(indexedProjects(db)).toEqual([
      { projectPath: PROJECT, symbols: 5, files: 4, indexedAt: 400 },
      { projectPath: '/small', symbols: 1, files: 1, indexedAt: 50 },
    ]);
  });
});

describe('projectRisk', () => {
  it('projects touched symbols and their callers onto the node ids of a level', () => {
    const touched = [
      { file: 'src/lib/core.ts', symbol: 'core', callers: ['src/feat/a.ts::useA', 'src/lib/core.ts::helper', 'bareName'] },
      { file: 'src/lib/core.ts', symbol: 'helper', callers: [] },
    ];
    expect(projectRisk('symbol', touched)).toEqual({
      touched: ['src/lib/core.ts::core', 'src/lib/core.ts::helper'],
      blast: ['src/feat/a.ts::useA'],
    });
    expect(projectRisk('file', touched)).toEqual({ touched: ['src/lib/core.ts'], blast: ['src/feat/a.ts'] });
    expect(projectRisk('module', touched)).toEqual({ touched: ['src/lib'], blast: ['src/feat'] });
  });
});
