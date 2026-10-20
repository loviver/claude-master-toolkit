import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
