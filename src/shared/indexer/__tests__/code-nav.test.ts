import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { searchSymbols, symbolDetails, symbolMatchScore } from '../code-nav.js';

const PROJECT = '/proj';
let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE symbols (
    project_path TEXT, file TEXT, symbol TEXT, kind TEXT, signature TEXT,
    start_line INTEGER, end_line INTEGER, exported INTEGER,
    deps TEXT, callers TEXT, refs TEXT, referrers TEXT, dep_sites TEXT, heritage TEXT, tokens_estimate INTEGER
  )`);
});

afterEach(() => db.close());

function sym(
  file: string,
  symbol: string,
  opts: {
    kind?: string;
    lines?: [number, number];
    exported?: boolean;
    deps?: string[];
    sites?: Record<string, number[]>;
    refs?: string[];
    heritage?: string[];
    project?: string;
  } = {},
): void {
  const [start, end] = opts.lines ?? [1, 5];
  db.prepare(
    `INSERT INTO symbols (project_path, file, symbol, kind, signature, start_line, end_line, exported,
       deps, callers, refs, dep_sites, heritage, tokens_estimate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, 0)`,
  ).run(
    opts.project ?? PROJECT, file, symbol, opts.kind ?? 'function', `${symbol}()`, start, end,
    opts.exported === false ? 0 : 1,
    JSON.stringify(opts.deps ?? []), JSON.stringify(opts.refs ?? []),
    opts.sites ? JSON.stringify(opts.sites) : null,
    opts.heritage ? JSON.stringify(opts.heritage) : null,
  );
}

describe('symbolMatchScore', () => {
  it('ranks exact, then prefix, then camel humps, then substring (lower is better)', () => {
    expect(symbolMatchScore('getcodegraph', 'getCodeGraph')).toBe(0);
    expect(symbolMatchScore('getCode', 'getCodeGraph')).toBe(1);
    expect(symbolMatchScore('gCG', 'getCodeGraph')).toBe(2);
    expect(symbolMatchScore('odeGr', 'getCodeGraph')).toBe(3);
  });

  it('returns null when the query matches nothing', () => {
    expect(symbolMatchScore('xyz', 'getCodeGraph')).toBeNull();
    expect(symbolMatchScore('cg', 'clog')).toBeNull();
    expect(symbolMatchScore('   ', 'anything')).toBeNull();
  });

  it('matches humps case-insensitively, acronyms included', () => {
    expect(symbolMatchScore('gcg', 'getCodeGraph')).toBe(2);
    expect(symbolMatchScore('HP', 'HTMLParser')).toBe(2);
    expect(symbolMatchScore('ucg', 'use_code_graph')).toBe(2);
  });

  it('matches a method by its member name, and by its full name when the query has a dot', () => {
    expect(symbolMatchScore('doThing', 'Svc.doThing')).toBe(0);
    expect(symbolMatchScore('Svc.do', 'Svc.doThing')).toBe(1);
    expect(symbolMatchScore('Svc', 'Svc.doThing')).toBeNull();
  });
});

describe('searchSymbols', () => {
  beforeEach(() => {
    sym('src/graph.ts', 'getCodeGraph');
    sym('src/graph.ts', 'graph', { exported: false });
    sym('src/other.ts', 'graph', { lines: [10, 12] });
    sym('src/view.ts', 'GraphView', { kind: 'class' });
    sym('src/view.ts', 'GraphView.render', { kind: 'method', lines: [3, 4] });
    sym('src/elsewhere.ts', 'graph', { project: '/other' });
  });

  it('orders by match quality, exported first among equals, and stays inside the project', () => {
    const hits = searchSymbols(db, PROJECT, 'graph');
    expect(hits.map((h) => h.id)).toEqual([
      'src/other.ts::graph',
      'src/graph.ts::graph',
      'src/view.ts::GraphView',
      'src/graph.ts::getCodeGraph',
    ]);
  });

  it('returns locations the viewer can open', () => {
    expect(searchSymbols(db, PROJECT, 'render')).toEqual([{
      id: 'src/view.ts::GraphView.render',
      symbol: 'GraphView.render',
      kind: 'method',
      file: 'src/view.ts',
      startLine: 3,
      endLine: 4,
      exported: true,
      signature: 'GraphView.render()',
    }]);
  });

  it('caps the hits and ignores a blank query', () => {
    expect(searchSymbols(db, PROJECT, 'graph', 2)).toHaveLength(2);
    expect(searchSymbols(db, PROJECT, '  ')).toEqual([]);
  });
});

describe('symbolDetails', () => {
  beforeEach(() => {
    sym('src/core.ts', 'core', { lines: [1, 3] });
    sym('src/a.ts', 'useA', { lines: [4, 9], deps: ['src/core.ts::core'], sites: { 'src/core.ts::core': [7, 5] } });
    sym('src/shapes.ts', 'Shape', { kind: 'class', lines: [1, 10] });
    sym('src/shapes.ts', 'Shape.area', { kind: 'method', lines: [2, 4] });
    sym('src/shapes.ts', 'Shape.area.inner', { kind: 'const', lines: [3, 3] });
    sym('src/circle.ts', 'Circle', { kind: 'class', lines: [1, 8], heritage: ['src/shapes.ts::Shape'] });
    sym('src/circle.ts', 'Circle.area', { kind: 'method', lines: [2, 5] });
    sym('src/draw.ts', 'draw', {
      lines: [10, 14],
      deps: ['src/shapes.ts::Shape.area'],
      sites: { 'src/shapes.ts::Shape.area': [12] },
      refs: ['src/shapes.ts::Shape'],
    });
  });

  it('is null for an id the index does not have', () => {
    expect(symbolDetails(db, PROJECT, 'src/core.ts::nope')).toBeNull();
  });

  it('lists callers with the lines of each call site', () => {
    const d = symbolDetails(db, PROJECT, 'src/core.ts::core')!;
    expect(d).toMatchObject({ id: 'src/core.ts::core', file: 'src/core.ts', startLine: 1, endLine: 3, exported: true });
    expect(d.callers).toEqual([
      { id: 'src/a.ts::useA', symbol: 'useA', kind: 'function', file: 'src/a.ts', startLine: 4, endLine: 9, lines: [5, 7] },
    ]);
  });

  it('lists what a symbol calls with the lines inside it', () => {
    const d = symbolDetails(db, PROJECT, 'src/a.ts::useA')!;
    expect(d.callees.map((c) => [c.id, c.lines])).toEqual([['src/core.ts::core', [5, 7]]]);
  });

  it('attributes a call through a supertype to each override, at the same call site', () => {
    const d = symbolDetails(db, PROJECT, 'src/circle.ts::Circle.area')!;
    expect(d.callers.map((c) => [c.id, c.lines])).toEqual([['src/draw.ts::draw', [12]]]);
    const draw = symbolDetails(db, PROJECT, 'src/draw.ts::draw')!;
    expect(draw.callees.map((c) => [c.id, c.lines, c.dispatch])).toEqual([
      ['src/circle.ts::Circle.area', [12], true],
      ['src/shapes.ts::Shape.area', [12], undefined],
    ]);
    expect(draw.references.map((r) => r.id)).toEqual(['src/shapes.ts::Shape']);
  });

  it('exposes the type hierarchy, referrers and direct members', () => {
    const shape = symbolDetails(db, PROJECT, 'src/shapes.ts::Shape')!;
    expect(shape.subtypes.map((s) => s.id)).toEqual(['src/circle.ts::Circle']);
    expect(shape.referrers.map((s) => s.id)).toEqual(['src/draw.ts::draw']);
    expect(shape.members.map((s) => s.id)).toEqual(['src/shapes.ts::Shape.area']);
    const circle = symbolDetails(db, PROJECT, 'src/circle.ts::Circle')!;
    expect(circle.supertypes.map((s) => s.id)).toEqual(['src/shapes.ts::Shape']);
  });
});
