import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { rankSymbols, repoMap } from '../repo-map.js';

const PROJECT = '/proj';
let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE symbols (
    project_path TEXT, file TEXT, symbol TEXT, kind TEXT, signature TEXT,
    start_line INTEGER, end_line INTEGER, exported INTEGER,
    deps TEXT, callers TEXT, refs TEXT, referrers TEXT, dep_sites TEXT, tokens_estimate INTEGER
  )`);
});

afterEach(() => db.close());

function sym(file: string, symbol: string, opts: { deps?: string[]; refs?: string[]; signature?: string } = {}): void {
  db.prepare(
    `INSERT INTO symbols (project_path, file, symbol, kind, signature, start_line, end_line, exported, deps, callers, refs, tokens_estimate)
     VALUES (?, ?, ?, 'function', ?, 1, 1, 1, ?, '[]', ?, 0)`,
  ).run(PROJECT, file, symbol, opts.signature ?? `${symbol}()`, JSON.stringify(opts.deps ?? []), JSON.stringify(opts.refs ?? []));
}

const order = (res: ReturnType<typeof repoMap>) => res.files.flatMap((f) => f.symbols.map((s) => s.symbol));

describe('rankSymbols — PageRank', () => {
  it('ranks the node every other node points at first', () => {
    const rank = rankSymbols(['a', 'b', 'c', 'hub'], [
      ['a', 'hub', 1],
      ['b', 'hub', 1],
      ['c', 'hub', 1],
    ]);
    const top = [...rank.entries()].sort((x, y) => y[1] - x[1])[0][0];
    expect(top).toBe('hub');
  });

  it('returns a probability distribution (sums to ~1, dangling mass kept)', () => {
    const rank = rankSymbols(['a', 'b', 'c'], [['a', 'b', 1]]);
    const total = [...rank.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('personalization lifts the focused node and its neighbours', () => {
    const nodes = ['x', 'y', 'p', 'q'];
    const edges: Array<[string, string, number]> = [['x', 'y', 1], ['p', 'q', 1]];
    const plain = rankSymbols(nodes, edges);
    const focused = rankSymbols(nodes, edges, new Set(['p']));
    expect(focused.get('q')!).toBeGreaterThan(plain.get('q')!);
    expect(focused.get('q')!).toBeGreaterThan(focused.get('y')!);
  });
});

describe('repoMap', () => {
  function seed(): void {
    sym('src/core.ts', 'core', { signature: 'core(x: number): number' });
    sym('src/a.ts', 'useA', { deps: ['src/core.ts::core'] });
    sym('src/b.ts', 'useB', { deps: ['src/core.ts::core'] });
    sym('src/c.ts', 'leaf', { refs: ['src/b.ts::useB'] });
  }

  it('lists the most depended-on symbol first, with its signature, grouped by file', () => {
    seed();
    const res = repoMap(db, PROJECT);
    expect(res.files[0]).toEqual({ file: 'src/core.ts', symbols: [{ symbol: 'core', kind: 'function', signature: 'core(x: number): number' }] });
    expect(res.totalSymbols).toBe(4);
    expect(res.truncated).toBe(false);
  });

  it('focus (file or symbol) pulls that area to the top', () => {
    seed();
    sym('src/c.ts', 'other');
    const res = repoMap(db, PROJECT, { focus: ['src/c.ts'] });
    expect(order(res).slice(0, 2).sort()).toEqual(['leaf', 'other']);
  });

  it('cuts at the token budget and reports truncation', () => {
    seed();
    const res = repoMap(db, PROJECT, { budget: 12 });
    expect(order(res).length).toBeLessThan(4);
    expect(order(res).length).toBeGreaterThan(0);
    expect(res.truncated).toBe(true);
  });

  it('ignores edges to symbols outside the index and bare (unresolved) ids', () => {
    sym('src/a.ts', 'solo', { deps: ['gone.ts::x', 'bareName'] });
    expect(order(repoMap(db, PROJECT))).toEqual(['solo']);
  });

  it('empty project → empty map', () => {
    expect(repoMap(db, PROJECT)).toEqual({ files: [], truncated: false, totalSymbols: 0 });
  });
});
