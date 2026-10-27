import { describe, it, expect } from 'vitest';
import type { CodeGraphDiffDTO } from '../../../lib/types';
import { diffRows, firstChangeIndex, hunkSymbols, inlineChanges, markTokens, wordRanges } from '../diff-model';

const hunk = (oldStart: number, newStart: number, lines: CodeGraphDiffDTO['hunks'][number]['lines'], section = '') =>
  ({ oldStart, newStart, section, lines });

describe('diffRows', () => {
  it('puts a header before each hunk with the lines it skips since the previous one', () => {
    const rows = diffRows([
      hunk(1, 1, [{ kind: 'add', old: null, new: 1, text: 'a' }]),
      hunk(10, 11, [{ kind: 'context', old: 10, new: 11, text: 'b' }], 'function f()'),
    ]);
    expect(rows).toEqual([
      { type: 'hunk', skipped: 0, newStart: 1, section: '' },
      { type: 'line', line: { kind: 'add', old: null, new: 1, text: 'a' } },
      { type: 'hunk', skipped: 9, newStart: 11, section: 'function f()' },
      { type: 'line', line: { kind: 'context', old: 10, new: 11, text: 'b' } },
    ]);
  });

  it('counts lines hidden above the first hunk', () => {
    const rows = diffRows([hunk(40, 40, [{ kind: 'del', old: 40, new: null, text: 'x' }])]);
    expect(rows[0]).toEqual({ type: 'hunk', skipped: 39, newStart: 40, section: '' });
  });

  it('no hunks → no rows', () => {
    expect(diffRows([])).toEqual([]);
  });
});

describe('firstChangeIndex', () => {
  it('finds the row of the first change on or after a new-side line', () => {
    const rows = diffRows([
      hunk(1, 1, [
        { kind: 'context', old: 1, new: 1, text: 'a' },
        { kind: 'add', old: null, new: 2, text: 'b' },
      ]),
      hunk(20, 21, [
        { kind: 'del', old: 20, new: null, text: 'c' },
        { kind: 'add', old: null, new: 21, text: 'd' },
      ]),
    ]);
    expect(firstChangeIndex(rows, null)).toBe(2);
    expect(firstChangeIndex(rows, 21)).toBe(4);
    expect(firstChangeIndex(rows, 99)).toBe(-1);
  });
});

describe('wordRanges', () => {
  it('marks only the tokens that differ, on each side', () => {
    const a = "export function Badge({ children, size = 'sm' }: Props) {";
    const b = "export function Badge({ children, size = 'sm', title }: Props) {";
    const { del, add } = wordRanges(a, b);
    expect(del).toEqual([]);
    expect(add.map(([s, e]) => b.slice(s, e))).toEqual([', title']);
  });

  it('marks a replaced word on both sides', () => {
    const { del, add } = wordRanges('return a + b;', 'return a - b;');
    expect(del).toEqual([[9, 10]]);
    expect(add).toEqual([[9, 10]]);
  });

  it('gives up on lines that share too little: the whole line is the change', () => {
    expect(wordRanges('const x = 1;', 'import y from "z";')).toEqual({ del: [], add: [] });
  });
});

describe('inlineChanges', () => {
  it('pairs the n-th − with the n-th + of each block of changes', () => {
    const rows = diffRows([
      hunk(1, 1, [
        { kind: 'del', old: 1, new: null, text: 'let a = 1;' },
        { kind: 'del', old: 2, new: null, text: 'let b = 2;' },
        { kind: 'add', old: null, new: 1, text: 'let a = 9;' },
        { kind: 'context', old: 3, new: 2, text: 'x' },
        { kind: 'add', old: null, new: 3, text: 'let c = 3;' },
      ]),
    ]);
    const marks = inlineChanges(rows);
    expect([...marks.keys()]).toEqual([1, 3]);
    expect(marks.get(1)).toEqual([[8, 9]]);
    expect(marks.get(3)).toEqual([[8, 9]]);
  });
});

describe('markTokens', () => {
  it('splits tokens at the range edges and flags the changed pieces', () => {
    const tokens = [{ content: 'abc', types: ['x'] }, { content: 'def', types: ['y'] }];
    expect(markTokens(tokens, [[2, 4]])).toEqual([
      { token: { content: 'ab', types: ['x'] }, changed: false },
      { token: { content: 'c', types: ['x'] }, changed: true },
      { token: { content: 'd', types: ['y'] }, changed: true },
      { token: { content: 'ef', types: ['y'] }, changed: false },
    ]);
  });

  it('no ranges → the tokens as they are', () => {
    const tokens = [{ content: 'abc', types: [] }];
    expect(markTokens(tokens, [])).toEqual([{ token: tokens[0], changed: false }]);
  });
});

describe('hunkSymbols', () => {
  const change = (symbol: string, startLine: number, endLine: number, ranges: Array<[number, number]>, callers: string[] = []) =>
    ({ id: `f.ts::${symbol}`, file: 'f.ts', symbol, exported: true, startLine, endLine, callers, deps: [], ranges, added: 1, removed: 0 });

  it('lists the changed symbols a hunk touches, flagging a changed declaration line', () => {
    const rows = diffRows([
      hunk(10, 10, [
        { kind: 'context', old: 10, new: 10, text: 'a' },
        { kind: 'add', old: null, new: 11, text: 'b' },
      ]),
      hunk(40, 41, [{ kind: 'add', old: null, new: 41, text: 'c' }]),
    ]);
    const changes = [change('Head', 11, 20, [[11, 11]], ['g.ts::x', 'g.ts::y']), change('Body', 30, 50, [[41, 41]]), change('Other', 1, 5, [[2, 2]])];
    const other = { ...change('Head', 11, 20, [[11, 11]]), file: 'g.ts', id: 'g.ts::Head' };
    const out = hunkSymbols(rows, [...changes, other], 'f.ts');
    expect([...out.keys()]).toEqual([0, 3]);
    expect(out.get(0)).toEqual([{ change: changes[0], declaration: true }]);
    expect(out.get(3)).toEqual([{ change: changes[1], declaration: false }]);
  });
});
