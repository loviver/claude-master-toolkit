import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  buildCodeGraph,
  containerId,
  graphRevision,
  indexedProjects,
  projectRisk,
  projectStatus,
  riskChanges,
  sourceLanguage,
} from '../code-graph.js';

const PROJECT = '/proj';
let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE symbols (
    project_path TEXT, file TEXT, symbol TEXT, kind TEXT, signature TEXT,
    start_line INTEGER, end_line INTEGER, exported INTEGER,
    deps TEXT, callers TEXT, refs TEXT, referrers TEXT, dep_sites TEXT, heritage TEXT, tokens_estimate INTEGER
  )`);
  db.exec(`CREATE TABLE indexed_files (
    project_path TEXT, file TEXT, hash TEXT, indexed_at INTEGER, imports TEXT
  )`);
});

afterEach(() => db.close());

function sym(
  file: string,
  symbol: string,
  opts: { deps?: string[]; refs?: string[]; heritage?: string[]; kind?: string; exported?: boolean; project?: string } = {},
): void {
  db.prepare(
    `INSERT INTO symbols (project_path, file, symbol, kind, signature, start_line, end_line, exported, deps, callers, refs, heritage, tokens_estimate)
     VALUES (?, ?, ?, ?, ?, 3, 9, ?, ?, '[]', ?, ?, 0)`,
  ).run(
    opts.project ?? PROJECT, file, symbol, opts.kind ?? 'function', `${symbol}()`, opts.exported === false ? 0 : 1,
    JSON.stringify(opts.deps ?? []), JSON.stringify(opts.refs ?? []), opts.heritage ? JSON.stringify(opts.heritage) : null,
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

  // Impact is project-wide: a scope left over from browsing a folder used to hide the
  // focus itself ("neither a node nor a folder") or the callers outside that folder.
  it('focus ignores scope: the target and its callers are found anywhere', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol', scope: 'src/lib', focus: 'src/feat/b.ts::useB', depth: 1 });
    expect(g.stats.focusMatches).toBe(1);
    expect(ids(g)).toContain('src/feat/b.ts::useB');
    expect(ids(g)).toContain('src/feat/c.ts::leaf');
  });

  it('focusIds seeds the walk with a set of nodes (the diff), unknown ids skipped', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, {
      level: 'file', focusIds: ['src/lib/core.ts', 'gone.ts'], depth: 1, direction: 'callers',
    });
    expect(g.stats.focusMatches).toBe(1);
    expect(ids(g)).toContain('src/lib/core.ts');
    expect(ids(g)).toEqual(['src/feat/a.ts', 'src/feat/b.ts', 'src/lib/core.ts']);
  });

  it('an unknown focus yields an empty graph rather than the whole repo', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol', focus: 'nope::nothing' });
    expect(g.nodes).toEqual([]);
    expect(g.links).toEqual([]);
    expect(g.stats.focusMatches).toBe(0);
  });

  it('direction "callers" walks only incoming edges: what a change would break', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol', focus: 'src/lib/core.ts::core', depth: 2, direction: 'callers' });
    expect(ids(g)).toEqual(['src/feat/a.ts::useA', 'src/feat/b.ts::useB', 'src/feat/c.ts::leaf', 'src/lib/core.ts::core']);
    const fromB = buildCodeGraph(db, PROJECT, { level: 'symbol', focus: 'src/feat/b.ts::useB', depth: 1, direction: 'callers' });
    expect(ids(fromB)).toEqual(['src/feat/b.ts::useB', 'src/feat/c.ts::leaf']);
  });

  it('direction "deps" walks only outgoing edges', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol', focus: 'src/feat/b.ts::useB', depth: 3, direction: 'deps' });
    expect(ids(g)).toEqual(['src/feat/b.ts::useB', 'src/lib/core.ts::core', 'src/lib/core.ts::helper']);
  });

  it('a folder focus seeds the walk with every node under it, at any level', () => {
    seed();
    const sym = buildCodeGraph(db, PROJECT, { level: 'symbol', focus: 'src/feat', depth: 1, direction: 'deps' });
    expect(ids(sym)).toEqual([
      'src/feat/a.ts::useA',
      'src/feat/b.ts::useB',
      'src/feat/c.ts::leaf',
      'src/lib/core.ts::core',
      'src/lib/core.ts::helper',
    ]);
    expect(sym.stats.focusMatches).toBe(3);
    const files = buildCodeGraph(db, PROJECT, { level: 'file', focus: 'src/lib/', depth: 1, direction: 'callers' });
    expect(ids(files)).toEqual(['src/feat/a.ts', 'src/feat/b.ts', 'src/lib/core.ts']);
    const modules = buildCodeGraph(db, PROJECT, { level: 'module', focus: 'src', depth: 1 });
    expect(modules.stats.focusMatches).toBe(2);
  });

  it('a folder focus matches whole path segments', () => {
    seed();
    sym('src/featured/z.ts', 'z');
    const g = buildCodeGraph(db, PROJECT, { level: 'file', focus: 'src/feat', depth: 1, direction: 'deps' });
    expect(ids(g)).not.toContain('src/featured/z.ts');
  });

  it('folder seeds survive the limit ahead of higher-ranked neighbours', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'file', focus: 'src/feat', depth: 1, limit: 3 });
    expect(ids(g)).toEqual(['src/feat/a.ts', 'src/feat/b.ts', 'src/feat/c.ts']);
    expect(g.stats.truncated).toBe(true);
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

describe('buildCodeGraph — inheritance and dispatch', () => {
  const STRATEGY = 'src/s/strategy.ts::Strategy';

  /** Strategy ← A, B, D (implements); B ← C (extends). Svc.go calls Strategy.run through the interface. */
  function seedStrategies(callTarget = `${STRATEGY}.run`): void {
    sym('src/s/strategy.ts', 'Strategy', { kind: 'interface' });
    sym('src/s/a.ts', 'A', { kind: 'class', heritage: [STRATEGY] });
    sym('src/s/a.ts', 'A.run', { kind: 'method' });
    sym('src/s/b.ts', 'B', { kind: 'class', heritage: [STRATEGY] });
    sym('src/s/b.ts', 'B.run', { kind: 'method' });
    sym('src/s/c.ts', 'C', { kind: 'class', heritage: ['src/s/b.ts::B'] });
    sym('src/s/c.ts', 'C.run', { kind: 'method' });
    sym('src/s/d.ts', 'D', { kind: 'class', heritage: [STRATEGY] });
    sym('src/svc.ts', 'Svc.go', { kind: 'method', deps: [callTarget] });
  }

  it('draws extends/implements as inherit links from subtype to supertype', () => {
    seedStrategies();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol' });
    expect(linkKeys(g).filter((k) => k.includes(':inherit:'))).toEqual([
      `src/s/a.ts::A>${STRATEGY}:inherit:1`,
      `src/s/b.ts::B>${STRATEGY}:inherit:1`,
      'src/s/c.ts::C>src/s/b.ts::B:inherit:1',
      `src/s/d.ts::D>${STRATEGY}:inherit:1`,
    ]);
  });

  it('a call through an interface reaches the contract and dispatches to every implementation', () => {
    seedStrategies();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol' });
    const fromGo = linkKeys(g).filter((k) => k.startsWith('src/svc.ts::Svc.go>'));
    expect(fromGo).toEqual([
      'src/svc.ts::Svc.go>src/s/a.ts::A.run:dispatch:1',
      'src/svc.ts::Svc.go>src/s/b.ts::B.run:dispatch:1',
      'src/svc.ts::Svc.go>src/s/c.ts::C.run:dispatch:1',
      `src/svc.ts::Svc.go>${STRATEGY}:call:1`,
    ]);
    expect(g.stats.unresolved).toBe(0);
  });

  it('a call to a concrete method also dispatches to its overrides', () => {
    seedStrategies('src/s/b.ts::B.run');
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol' });
    expect(linkKeys(g).filter((k) => k.startsWith('src/svc.ts::Svc.go>'))).toEqual([
      'src/svc.ts::Svc.go>src/s/b.ts::B.run:call:1',
      'src/svc.ts::Svc.go>src/s/c.ts::C.run:dispatch:1',
    ]);
  });

  it('the callers impact of a strategy method reaches the code that dispatches to it', () => {
    seedStrategies();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol', focus: 'src/s/a.ts::A.run', depth: 1, direction: 'callers' });
    expect(ids(g)).toEqual(['src/s/a.ts::A.run', 'src/svc.ts::Svc.go']);
  });

  it('a member call whose owner is not indexed still counts as unresolved', () => {
    sym('src/svc.ts', 'go', { deps: ['src/nope.ts::Ghost.run'] });
    expect(buildCodeGraph(db, PROJECT, { level: 'symbol' }).stats.unresolved).toBe(1);
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

describe('riskChanges', () => {
  it('lists touched symbols most-called first, with their changed lines, callers and deps', () => {
    const touched = [
      { file: 'a.ts', symbol: 'leaf', exported: false, range: [1, 4] as [number, number], callers: [], deps: [] },
      {
        file: 'b.ts', symbol: 'hub', exported: true, range: [10, 20] as [number, number],
        callers: ['c.ts::use', 'a.ts::leaf', 'bare', 'c.ts::use', 'd.ts::other'],
        deps: ['e.ts::repo', 'b.ts::hub', 'bare', 'a.ts::leaf', 'e.ts::repo'],
      },
    ];
    const ranges = [
      { file: 'b.ts', start: 12, end: 13, added: 2, removed: 1 },
      { file: 'a.ts', start: 2, end: 2, added: 1, removed: 0 },
      { file: 'b.ts', start: 18, end: 18, added: 0, removed: 3 },
    ];
    expect(riskChanges(touched, ranges)).toEqual({
      changes: [
        {
          id: 'b.ts::hub', file: 'b.ts', symbol: 'hub', exported: true, startLine: 10, endLine: 20,
          callers: ['c.ts::use', 'd.ts::other'], deps: ['a.ts::leaf', 'e.ts::repo'],
          ranges: [[12, 13], [18, 18]], added: 2, removed: 4,
        },
        {
          id: 'a.ts::leaf', file: 'a.ts', symbol: 'leaf', exported: false, startLine: 1, endLine: 4,
          callers: [], deps: [], ranges: [[2, 2]], added: 1, removed: 0,
        },
      ],
      files: [
        { file: 'a.ts', ranges: [[2, 2]], added: 1, removed: 0, outside: [] },
        { file: 'b.ts', ranges: [[12, 13], [18, 18]], added: 2, removed: 4, outside: [] },
      ],
    });
  });

  it('clips a hunk to each symbol it crosses and keeps the rest as lines outside any symbol', () => {
    const touched = [{ file: 'a.ts', symbol: 'fn', exported: true, range: [5, 9] as [number, number], callers: [], deps: [] }];
    const ranges = [
      { file: 'a.ts', start: 1, end: 6, added: 6, removed: 0 },
      { file: 'a.ts', start: 30, end: 31, added: 2, removed: 1 },
    ];
    const { changes, files } = riskChanges(touched, ranges);
    expect(changes[0]).toMatchObject({ ranges: [[5, 6]], added: 2, removed: 0 });
    expect(files[0]).toMatchObject({ added: 8, removed: 1, outside: [[1, 4], [30, 31]] });
  });
});

describe('sourceLanguage', () => {
  it('maps extensions to bundled Prism grammars', () => {
    expect(sourceLanguage('src/a.tsx')).toBe('tsx');
    expect(sourceLanguage('lib/x.MJS')).toBe('javascript');
    expect(sourceLanguage('main.rs')).toBe('rust');
    expect(sourceLanguage('Makefile')).toBeNull();
    expect(sourceLanguage('notes.zig')).toBeNull();
  });
});

describe('buildCodeGraph — metrics', () => {
  it('symbol level: loc is the symbol span, callers counts distinct incoming nodes', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol' });
    const core = g.nodes.find((n) => n.id === 'src/lib/core.ts::core')!;
    expect(core.loc).toBe(7);
    expect(core.callers).toBe(2);
    expect(g.nodes.find((n) => n.id === 'src/feat/a.ts::useA')!.callers).toBe(0);
  });

  it('aggregated levels sum loc over folded symbols', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'file' });
    expect(g.nodes.find((n) => n.id === 'src/lib/core.ts')!.loc).toBe(14);
  });

  it('callers is counted before the limit truncates the graph', () => {
    seed();
    const g = buildCodeGraph(db, PROJECT, { level: 'symbol', limit: 1 });
    expect(g.nodes[0].callers).toBe(2);
  });

  it('churn comes from the per-file map; a module counts each file once', () => {
    seed();
    const churn = new Map([['src/lib/core.ts', 5], ['src/feat/a.ts', 2], ['src/feat/b.ts', 1]]);
    const sym = buildCodeGraph(db, PROJECT, { level: 'symbol', churn });
    expect(sym.nodes.find((n) => n.id === 'src/lib/core.ts::helper')!.churn).toBe(5);
    const mod = buildCodeGraph(db, PROJECT, { level: 'module', churn });
    expect(mod.nodes.find((n) => n.id === 'src/lib')!.churn).toBe(5);
    expect(mod.nodes.find((n) => n.id === 'src/feat')!.churn).toBe(3);
  });

  it('churn is 0 without a churn map', () => {
    seed();
    expect(buildCodeGraph(db, PROJECT, { level: 'file' }).nodes.every((n) => n.churn === 0)).toBe(true);
  });
});

describe('projectStatus', () => {
  const touched = [
    { file: 'src/lib/new.ts', symbol: 'fresh', callers: [] },
    { file: 'src/lib/core.ts', symbol: 'core', callers: [] },
    { file: 'src/feat/a.ts', symbol: 'useA', callers: [] },
  ];
  const files = new Map([['src/lib/new.ts', 'added'], ['src/lib/core.ts', 'modified'], ['src/feat/a.ts', 'added']] as const);

  it('takes each touched node\'s file status; files the status map misses count as modified', () => {
    expect(projectStatus('symbol', touched, files)).toEqual({
      'src/lib/new.ts::fresh': 'added', 'src/lib/core.ts::core': 'modified', 'src/feat/a.ts::useA': 'added',
    });
    expect(projectStatus('file', [{ file: 'x.ts', symbol: 's', callers: [] }], new Map())).toEqual({ 'x.ts': 'modified' });
  });

  it('a module is added only when every touched file in it is added', () => {
    expect(projectStatus('module', touched, files)).toEqual({ 'src/lib': 'modified', 'src/feat': 'added' });
  });
});
