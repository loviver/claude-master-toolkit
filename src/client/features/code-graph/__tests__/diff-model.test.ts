import { describe, it, expect } from 'vitest';
import type { CodeGraphDiffDTO } from '../../../lib/types';
import { diffRows, firstChangeIndex } from '../diff-model';

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
