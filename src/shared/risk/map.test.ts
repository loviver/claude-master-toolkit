import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { rangesOverlap, mapTouchedSymbols } from './map.js';
import type { TouchedRange } from './diff.js';

describe('rangesOverlap — inclusive on both edges', () => {
  it('true when one range sits inside the other', () => {
    expect(rangesOverlap(10, 20, 15, 16)).toBe(true);
  });
  it('true when ranges merely touch at an edge', () => {
    expect(rangesOverlap(10, 20, 20, 30)).toBe(true);
    expect(rangesOverlap(10, 20, 5, 10)).toBe(true);
  });
  it('false when fully disjoint', () => {
    expect(rangesOverlap(10, 20, 21, 30)).toBe(false);
    expect(rangesOverlap(10, 20, 5, 9)).toBe(false);
  });
});

describe('mapTouchedSymbols — range overlap against the symbols table', () => {
  const PROJ = '/proj';
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE symbols (
        project_path TEXT, file TEXT, symbol TEXT,
        start_line INTEGER, end_line INTEGER,
        exported INTEGER, callers TEXT, deps TEXT
      );
    `);
    const insert = db.prepare(`
      INSERT INTO symbols (project_path, file, symbol, start_line, end_line, exported, callers, deps)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(PROJ, 'src/a.ts', 'foo', 10, 20, 1, JSON.stringify(['bar', 'baz']), JSON.stringify(['src/b.ts::other']));
    insert.run(PROJ, 'src/a.ts', 'qux', 30, 40, 0, null, null);
    insert.run(PROJ, 'src/b.ts', 'other', 1, 5, 1, JSON.stringify(['foo']), null);
    insert.run('/other', 'src/a.ts', 'wrongProj', 10, 20, 1, null, null);
  });

  afterEach(() => db.close());

  const range = (file: string, start: number, end: number): TouchedRange => ({ file, start, end, added: 1, removed: 0 });

  it('returns only the symbol whose line span overlaps the touched range', () => {
    const touched = mapTouchedSymbols(db, PROJ, [range('src/a.ts', 15, 16)]);
    expect(touched).toEqual([
      { file: 'src/a.ts', symbol: 'foo', exported: true, callers: ['bar', 'baz'], deps: ['src/b.ts::other'], range: [10, 20] },
    ]);
  });

  it('counts an edge touch as overlap', () => {
    const touched = mapTouchedSymbols(db, PROJ, [range('src/a.ts', 20, 20)]);
    expect(touched.map((t) => t.symbol)).toEqual(['foo']);
  });

  it('parses null callers and deps columns as empty arrays', () => {
    const touched = mapTouchedSymbols(db, PROJ, [range('src/a.ts', 35, 35)]);
    expect(touched).toEqual([
      { file: 'src/a.ts', symbol: 'qux', exported: false, callers: [], deps: [], range: [30, 40] },
    ]);
  });

  it('ignores symbols from a different project path', () => {
    // src/a.ts 10-20 exists under /other as wrongProj — must not leak in.
    const touched = mapTouchedSymbols(db, PROJ, [range('src/a.ts', 15, 15)]);
    expect(touched.map((t) => t.symbol)).toEqual(['foo']);
  });

  it('dedups a symbol hit by two overlapping ranges', () => {
    const touched = mapTouchedSymbols(db, PROJ, [range('src/a.ts', 11, 12), range('src/a.ts', 18, 19)]);
    expect(touched.map((t) => t.symbol)).toEqual(['foo']);
  });

  it('returns nothing for a range in a file with no indexed symbols', () => {
    expect(mapTouchedSymbols(db, PROJ, [range('src/ghost.ts', 1, 100)])).toEqual([]);
  });
});
