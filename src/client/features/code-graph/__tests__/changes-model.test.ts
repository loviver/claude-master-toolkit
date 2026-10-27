import { describe, it, expect } from 'vitest';
import type { CodeGraphChangeDTO, CodeGraphChangedFileDTO } from '../../../lib/types';
import { activeChange, changesTree, formatSpans, impactBadge, restrictToFiles } from '../changes-model';

function change(file: string, symbol: string, startLine: number, callers: string[] = []): CodeGraphChangeDTO {
  return {
    id: `${file}::${symbol}`, file, symbol, exported: true, startLine, endLine: startLine + 5,
    callers, deps: [], ranges: [[startLine, startLine]], added: 1, removed: 0,
  };
}

function file(path: string, outside: Array<[number, number]> = []): CodeGraphChangedFileDTO {
  return { file: path, ranges: [[1, 1]], added: 3, removed: 1, outside };
}

describe('changesTree', () => {
  it('nests each file\'s symbols in reading order, files with the widest impact first', () => {
    const tree = changesTree(
      [change('a.ts', 'late', 40), change('b.ts', 'hub', 3, ['x.ts::p', 'x.ts::q']), change('a.ts', 'early', 2, ['x.ts::p'])],
      [file('a.ts', [[1, 1]]), file('b.ts')],
    );
    expect(tree.map((f) => f.file)).toEqual(['b.ts', 'a.ts']);
    expect(tree[1].symbols.map((s) => s.symbol)).toEqual(['early', 'late']);
    expect(tree[1]).toMatchObject({ callers: 1, outside: [[1, 1]], added: 3, removed: 1 });
  });

  it('counts a caller shared by two changed symbols once per file', () => {
    const tree = changesTree([change('a.ts', 'f', 1, ['x.ts::p']), change('a.ts', 'g', 9, ['x.ts::p'])], [file('a.ts')]);
    expect(tree[0].callers).toBe(1);
  });

  it('keeps a changed file that touches no symbol', () => {
    expect(changesTree([], [file('README.md', [[1, 1]])])).toMatchObject([{ file: 'README.md', symbols: [], callers: 0 }]);
  });
});

describe('formatSpans', () => {
  it('prints single lines and spans, eliding past a limit', () => {
    expect(formatSpans([[4, 4], [10, 12]])).toBe('L4, L10–12');
    expect(formatSpans([[1, 1], [3, 3], [5, 5], [7, 7]], 2)).toBe('L1, L3 +2');
  });
});

describe('impactBadge', () => {
  const node = (symbols: number, callers: number) =>
    ({ file: 'a.ts', added: 1, removed: 0, outside: [], symbols: Array(symbols).fill({}), callers }) as never;

  it('shows the caller count when the file has indexed changed symbols', () => {
    expect(impactBadge(node(2, 0))).toBe('0');
    expect(impactBadge(node(1, 7))).toBe('7');
  });

  it('shows — when no indexed symbol covers the change: unknown impact, not zero', () => {
    expect(impactBadge(node(0, 0))).toBe('—');
  });
});

describe('activeChange', () => {
  const tree = changesTree([change('a.ts', 'f', 1), change('b.ts', 'g', 3)], [file('a.ts'), file('b.ts')]);

  it('points at the changed symbol being viewed, wherever the open tab is', () => {
    expect(activeChange(tree, 'a.ts', 'b.ts::g')).toEqual({ file: 'b.ts', symbol: 'b.ts::g' });
  });

  it('falls back to the open file row when the symbol is not part of the diff', () => {
    expect(activeChange(tree, 'a.ts', 'a.ts::untouched')).toEqual({ file: 'a.ts', symbol: null });
    expect(activeChange(tree, 'b.ts', null)).toEqual({ file: 'b.ts', symbol: null });
  });

  it('is null when nothing viewed is in the diff', () => {
    expect(activeChange(tree, 'other.ts', 'other.ts::x')).toBeNull();
    expect(activeChange(tree, null, null)).toBeNull();
  });
});

describe('restrictToFiles', () => {
  it('keeps only the diff of the given files (a session\'s), changes and files alike', () => {
    const out = restrictToFiles([change('a.ts', 'f', 1), change('b.ts', 'g', 3)], [file('a.ts'), file('b.ts')], new Set(['b.ts', 'c.ts']));
    expect(out.files.map((f) => f.file)).toEqual(['b.ts']);
    expect(out.changes.map((c) => c.id)).toEqual(['b.ts::g']);
  });

  it('keeps the whole diff when no restriction is given', () => {
    const out = restrictToFiles([change('a.ts', 'f', 1)], [file('a.ts')], null);
    expect(out.files).toHaveLength(1);
    expect(out.changes).toHaveLength(1);
  });
});
