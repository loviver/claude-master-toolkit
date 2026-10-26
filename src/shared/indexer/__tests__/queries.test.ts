import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { getCallers } from '../queries.js';

const PROJECT = '/proj';

let db: Database.Database;

function insert(row: {
  file: string;
  symbol: string;
  startLine: number;
  callers: string[];
}): void {
  db.prepare(
    `INSERT INTO symbols (project_path, file, symbol, kind, signature, start_line, end_line, exported, deps, callers, tokens_estimate)
     VALUES (?, ?, ?, 'function', NULL, ?, ?, 0, '[]', ?, 0)`,
  ).run(PROJECT, row.file, row.symbol, row.startLine, row.startLine, JSON.stringify(row.callers));
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE symbols (
    project_path TEXT, file TEXT, symbol TEXT, kind TEXT, signature TEXT,
    start_line INTEGER, end_line INTEGER, exported INTEGER,
    deps TEXT, callers TEXT, tokens_estimate INTEGER
  )`);
});

afterEach(() => db.close());

describe('getCallers — file-qualified disambiguation', () => {
  it('resolves a qualified caller id to the EXACT file, not every same-named symbol', () => {
    // `helper` is called by x.ts::run. A DECOY `run` lives in y.ts and calls nothing.
    // Old bare-name logic (`symbol IN ('run')`) would wrongly return BOTH runs.
    insert({ file: 'a.ts', symbol: 'helper', startLine: 1, callers: ['x.ts::run'] });
    insert({ file: 'x.ts', symbol: 'run', startLine: 5, callers: [] });
    insert({ file: 'y.ts', symbol: 'run', startLine: 99, callers: [] }); // decoy

    const res = getCallers(db, PROJECT, 'helper');

    expect(res.callers).toEqual([{ file: 'x.ts', symbol: 'run', line: 5 }]);
    expect(res.callers.some((c) => c.file === 'y.ts')).toBe(false);
  });

  it('aggregates callers across every file that defines the queried bare name', () => {
    // Two distinct `helper`s; a bare query for `helper` unions both call sets.
    insert({ file: 'a.ts', symbol: 'helper', startLine: 1, callers: ['m.ts::runA'] });
    insert({ file: 'b.ts', symbol: 'helper', startLine: 1, callers: ['n.ts::runB'] });
    insert({ file: 'm.ts', symbol: 'runA', startLine: 10, callers: [] });
    insert({ file: 'n.ts', symbol: 'runB', startLine: 20, callers: [] });

    const res = getCallers(db, PROJECT, 'helper');
    const names = res.callers.map((c) => `${c.file}:${c.symbol}:${c.line}`).sort();

    expect(names).toEqual(['m.ts:runA:10', 'n.ts:runB:20']);
  });

  it('returns no callers for an unknown symbol', () => {
    const res = getCallers(db, PROJECT, 'nope');
    expect(res.callers).toEqual([]);
  });
});

// ─── Phase 1: resolution + disambiguation ─────────────────────

import { understand, findSymbol } from '../queries.js';

function insertSym(row: {
  file: string;
  symbol: string;
  kind?: string;
  exported?: boolean;
  startLine?: number;
  deps?: string[];
  callers?: string[];
}): void {
  db.prepare(
    `INSERT INTO symbols (project_path, file, symbol, kind, signature, start_line, end_line, exported, deps, callers, tokens_estimate)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0)`,
  ).run(
    PROJECT,
    row.file,
    row.symbol,
    row.kind ?? 'function',
    row.startLine ?? 1,
    row.startLine ?? 1,
    row.exported ? 1 : 0,
    JSON.stringify(row.deps ?? []),
    JSON.stringify(row.callers ?? []),
  );
}

function seedFormatCurrency(): void {
  // Inserted in the order that used to win under LIMIT 1 (no ORDER BY).
  insertSym({ file: 'src/contexts/CurrencyContext.tsx', symbol: 'formatCurrency', exported: false, startLine: 95 });
  insertSym({ file: 'src/utils/currency-converter.ts', symbol: 'CurrencyConverter.formatCurrency', kind: 'method', startLine: 74 });
  insertSym({ file: 'src/utils/formatters.ts', symbol: 'formatCurrency', exported: true, startLine: 1 });
}

describe('understand — ranking and ambiguity', () => {
  it('ranks the exported exact-name definition first and flags ambiguity', () => {
    seedFormatCurrency();

    const res = understand(db, PROJECT, 'formatCurrency');

    expect(res?.file).toBe('src/utils/formatters.ts');
    expect(res?.ambiguous).toBe(true);
    expect(res?.alternatives.map((a) => a.file).sort()).toEqual([
      'src/contexts/CurrencyContext.tsx',
      'src/utils/currency-converter.ts',
    ]);
  });

  it('is not ambiguous when the name has a single definition', () => {
    insertSym({ file: 'a.ts', symbol: 'only', exported: true });

    const res = understand(db, PROJECT, 'only');

    expect(res?.ambiguous).toBe(false);
    expect(res?.alternatives).toEqual([]);
  });

  it('file option pins an exact path or a path suffix', () => {
    seedFormatCurrency();

    const bySuffix = understand(db, PROJECT, 'formatCurrency', { file: 'contexts/CurrencyContext.tsx' });
    const exact = understand(db, PROJECT, 'formatCurrency', { file: 'src/utils/formatters.ts' });

    expect(bySuffix?.file).toBe('src/contexts/CurrencyContext.tsx');
    expect(exact?.file).toBe('src/utils/formatters.ts');
    expect(exact?.ambiguous).toBe(false);
  });

  it('returns null when the file filter matches no definition', () => {
    seedFormatCurrency();
    expect(understand(db, PROJECT, 'formatCurrency', { file: 'nope.ts' })).toBeNull();
  });

  it('caps callers/deps at 15 and reports the full counts', () => {
    const many = Array.from({ length: 20 }, (_, i) => `f${i}.ts::c${i}`);
    insertSym({ file: 'a.ts', symbol: 'hot', exported: true, deps: many, callers: many });

    const res = understand(db, PROJECT, 'hot');

    expect(res?.callers).toHaveLength(15);
    expect(res?.deps).toHaveLength(15);
    expect(res?.callersCount).toBe(20);
    expect(res?.depsCount).toBe(20);
  });
});

describe('findSymbol — ranking and file filter', () => {
  it('returns ranked matches, exported exact-name first', () => {
    seedFormatCurrency();

    const files = findSymbol(db, PROJECT, 'formatCurrency').map((m) => m.file);

    expect(files[0]).toBe('src/utils/formatters.ts');
    expect(files).toHaveLength(3);
  });

  it('filters by file suffix', () => {
    seedFormatCurrency();

    const res = findSymbol(db, PROJECT, 'formatCurrency', { file: 'currency-converter.ts' });

    expect(res.map((m) => m.symbol)).toEqual(['CurrencyConverter.formatCurrency']);
  });
});

describe('getCallers — per-definition grouping', () => {
  it('groups callers by definition and keeps the flat list', () => {
    insertSym({ file: 'a.ts', symbol: 'helper', callers: ['m.ts::runA'] });
    insertSym({ file: 'b.ts', symbol: 'helper', callers: ['n.ts::runB'] });
    insertSym({ file: 'm.ts', symbol: 'runA', startLine: 10 });
    insertSym({ file: 'n.ts', symbol: 'runB', startLine: 20 });

    const res = getCallers(db, PROJECT, 'helper');

    expect(res.callers).toHaveLength(2);
    expect(res.definitions.map((d) => d.file).sort()).toEqual(['a.ts', 'b.ts']);
    expect(res.definitions.find((d) => d.file === 'a.ts')?.callers).toEqual([
      { file: 'm.ts', symbol: 'runA', line: 10 },
    ]);
  });

  it('file option restricts to that single definition', () => {
    insertSym({ file: 'a.ts', symbol: 'helper', callers: ['m.ts::runA'] });
    insertSym({ file: 'b.ts', symbol: 'helper', callers: ['n.ts::runB'] });
    insertSym({ file: 'm.ts', symbol: 'runA', startLine: 10 });
    insertSym({ file: 'n.ts', symbol: 'runB', startLine: 20 });

    const res = getCallers(db, PROJECT, 'helper', { file: 'b.ts' });

    expect(res.callers).toEqual([{ file: 'n.ts', symbol: 'runB', line: 20 }]);
    expect(res.definitions).toHaveLength(1);
  });
});

describe('ranking tiebreak — popularity', () => {
  it('prefers the definition with more callers when rank is otherwise tied', () => {
    // Alphabetically `a/` wins; popularity must beat path order.
    insertSym({ file: 'a/rarely.ts', symbol: 'fmt', exported: true, callers: ['x.ts::one'] });
    insertSym({ file: 'z/popular.ts', symbol: 'fmt', exported: true, callers: ['x.ts::one', 'y.ts::two', 'w.ts::three'] });

    expect(understand(db, PROJECT, 'fmt')?.file).toBe('z/popular.ts');
  });
});

// ─── Phase 2: refs / imports in the query layer ────────────────

import { getDeps } from '../queries.js';

describe('phase 2 query layer', () => {
  beforeEach(() => {
    db.exec(`ALTER TABLE symbols ADD COLUMN refs TEXT; ALTER TABLE symbols ADD COLUMN referrers TEXT;`);
    db.exec(`CREATE TABLE indexed_files (project_path TEXT, file TEXT, hash TEXT, indexed_at INTEGER, imports TEXT)`);
  });

  it('getDeps returns refs and the file imports alongside deps/exports', () => {
    insertSym({ file: 'a.ts', symbol: 'pick', exported: true, deps: ['u.ts::helper'] });
    db.prepare(`UPDATE symbols SET refs = ? WHERE symbol = 'pick'`).run(JSON.stringify(['c.ts::COLORS']));
    db.prepare(`INSERT INTO indexed_files VALUES (?, 'a.ts', 'h', 1, ?)`).run(
      PROJECT,
      JSON.stringify([{ module: 'react', names: ['useState'], external: true }]),
    );

    const res = getDeps(db, PROJECT, 'a.ts');

    expect(res.exports).toEqual(['pick']);
    expect(res.deps).toEqual(['u.ts::helper']);
    expect(res.refs).toEqual(['c.ts::COLORS']);
    expect(res.imports).toEqual([{ module: 'react', names: ['useState'], external: true }]);
  });

  it('getDeps tolerates a file with no stored imports', () => {
    insertSym({ file: 'b.ts', symbol: 'x' });
    expect(getDeps(db, PROJECT, 'b.ts').imports).toEqual([]);
  });

  describe('getDeps — symbol scope and export cap', () => {
    it('scopes exports/deps/refs to one symbol when `symbol` is given', () => {
      insertSym({ file: 'a.ts', symbol: 'one', exported: true, deps: ['u.ts::h1'] });
      insertSym({ file: 'a.ts', symbol: 'two', exported: true, deps: ['u.ts::h2'] });
      db.prepare(`UPDATE symbols SET refs = ? WHERE symbol = 'one'`).run(JSON.stringify(['c.ts::C1']));
      db.prepare(`UPDATE symbols SET refs = ? WHERE symbol = 'two'`).run(JSON.stringify(['c.ts::C2']));

      const res = getDeps(db, PROJECT, 'a.ts', { symbol: 'one' });

      expect(res.exports).toEqual(['one']);
      expect(res.deps).toEqual(['u.ts::h1']);
      expect(res.refs).toEqual(['c.ts::C1']);
    });

    it('keeps only the imports whose names appear in the symbol body', () => {
      const dir = mkdtempSync(join(tmpdir(), 'ctk-deps-'));
      writeFileSync(join(dir, 'a.ts'), 'const x = 1;\nexport const one = () => useState(x);\nexport const two = () => dayjs();\n');
      insertSym({ file: 'a.ts', symbol: 'one', exported: true, startLine: 2 });
      insertSym({ file: 'a.ts', symbol: 'two', exported: true, startLine: 3 });
      db.prepare(`INSERT INTO indexed_files VALUES (?, 'a.ts', 'h', 1, ?)`).run(
        dir,
        JSON.stringify([
          { module: 'react', names: ['useState'], external: true },
          { module: 'dayjs', names: ['dayjs'], external: true },
        ]),
      );
      db.prepare(`UPDATE symbols SET project_path = ?`).run(dir);

      const res = getDeps(db, dir, 'a.ts', { symbol: 'one' });

      expect(res.imports.map((i) => i.module)).toEqual(['react']);
    });

    it('caps exports on file-level queries and reports the full count', () => {
      for (let i = 0; i < 60; i++) insertSym({ file: 'big.ts', symbol: `S${i}`, exported: true });

      const res = getDeps(db, PROJECT, 'big.ts');

      expect(res.exports).toHaveLength(50);
      expect(res.exportsCount).toBe(60);
    });

    it('returns empty scope for an unknown symbol', () => {
      insertSym({ file: 'a.ts', symbol: 'one', exported: true });
      expect(getDeps(db, PROJECT, 'a.ts', { symbol: 'nope' }).exports).toEqual([]);
    });
  });

  describe('getCallers — call sites', () => {
    it('attaches the call lines recorded on the calling symbol', () => {
      db.exec(`ALTER TABLE symbols ADD COLUMN dep_sites TEXT`);
      insertSym({ file: 'u.ts', symbol: 'pick', exported: true, callers: ['m.ts::run'] });
      insertSym({ file: 'm.ts', symbol: 'run', startLine: 2, deps: ['u.ts::pick'] });
      db.prepare(`UPDATE symbols SET dep_sites = ? WHERE symbol = 'run'`).run(JSON.stringify({ 'u.ts::pick': [3, 4] }));

      const res = getCallers(db, PROJECT, 'pick', { file: 'u.ts' });

      expect(res.callers).toEqual([{ file: 'm.ts', symbol: 'run', line: 2, callSites: [3, 4] }]);
    });

    it('omits callSites when the caller has none recorded (older index)', () => {
      insertSym({ file: 'u.ts', symbol: 'pick', exported: true, callers: ['m.ts::run'] });
      insertSym({ file: 'm.ts', symbol: 'run', startLine: 2 });

      const res = getCallers(db, PROJECT, 'pick', { file: 'u.ts' });

      expect(res.callers[0]).not.toHaveProperty('callSites');
    });
  });

  function seedFilters(): void {
    insertSym({ file: 't.ts', symbol: 'Filters', kind: 'interface', exported: true, callers: ['m.ts::build'] });
    db.prepare(`UPDATE symbols SET referrers = ? WHERE symbol = 'Filters'`).run(JSON.stringify(['x.ts::use']));
    insertSym({ file: 'm.ts', symbol: 'build', startLine: 7 });
    insertSym({ file: 'x.ts', symbol: 'use', startLine: 3 });
  }

  it('getCallers reports call edges as callers and type/const usage as referrers', () => {
    seedFilters();
    const res = getCallers(db, PROJECT, 'Filters');
    expect(res.callers).toEqual([{ file: 'm.ts', symbol: 'build', line: 7 }]);
    expect(res.referrers).toEqual([{ file: 'x.ts', symbol: 'use', line: 3 }]);
    expect(res.definitions[0].referrers).toEqual([{ file: 'x.ts', symbol: 'use', line: 3 }]);
  });

  it('include=calls drops referrers; include=refs drops callers', () => {
    seedFilters();
    expect(getCallers(db, PROJECT, 'Filters', { include: 'calls' }).referrers).toEqual([]);
    expect(getCallers(db, PROJECT, 'Filters', { include: 'refs' }).callers).toEqual([]);
    expect(getCallers(db, PROJECT, 'Filters', { include: 'refs' }).referrers).toHaveLength(1);
  });
});
