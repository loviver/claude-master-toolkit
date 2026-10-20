import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from './diff.js';

describe('parseUnifiedDiff — hunk headers to touched ranges', () => {
  it('a single hunk with 3 added lines → one range on the + side', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index abc1234..def5678 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -10,0 +11,3 @@ context',
      '+line one',
      '+line two',
      '+line three',
    ].join('\n');

    expect(parseUnifiedDiff(diff)).toEqual([
      { file: 'src/foo.ts', start: 11, end: 13, added: 3 },
    ]);
  });

  it('an omitted count means exactly one line (+c @@ ≡ +c,1)', () => {
    const diff = [
      '--- a/src/bar.ts',
      '+++ b/src/bar.ts',
      '@@ -5 +5 @@',
      '-old',
      '+new',
    ].join('\n');

    expect(parseUnifiedDiff(diff)).toEqual([
      { file: 'src/bar.ts', start: 5, end: 5, added: 1 },
    ]);
  });

  it('multiple hunks in one file → one range each', () => {
    const diff = [
      '--- a/src/baz.ts',
      '+++ b/src/baz.ts',
      '@@ -1,0 +1,2 @@',
      '+a',
      '+b',
      '@@ -20,1 +22,1 @@',
      '-x',
      '+y',
    ].join('\n');

    expect(parseUnifiedDiff(diff)).toEqual([
      { file: 'src/baz.ts', start: 1, end: 2, added: 2 },
      { file: 'src/baz.ts', start: 22, end: 22, added: 1 },
    ]);
  });

  it('attributes each hunk to the file from its +++ header', () => {
    const diff = [
      '--- a/src/one.ts',
      '+++ b/src/one.ts',
      '@@ -1,0 +1,1 @@',
      '+one',
      'diff --git a/src/two.ts b/src/two.ts',
      '--- a/src/two.ts',
      '+++ b/src/two.ts',
      '@@ -3,0 +4,2 @@',
      '+two',
      '+three',
    ].join('\n');

    expect(parseUnifiedDiff(diff)).toEqual([
      { file: 'src/one.ts', start: 1, end: 1, added: 1 },
      { file: 'src/two.ts', start: 4, end: 5, added: 2 },
    ]);
  });

  it('a pure deletion (+c,0) still touches the file at line c with added 0', () => {
    const diff = [
      '--- a/src/del.ts',
      '+++ b/src/del.ts',
      '@@ -20,2 +23,0 @@',
      '-gone one',
      '-gone two',
    ].join('\n');

    expect(parseUnifiedDiff(diff)).toEqual([
      { file: 'src/del.ts', start: 23, end: 23, added: 0 },
    ]);
  });

  it('a wholly deleted file (+++ /dev/null) contributes no ranges', () => {
    const diff = [
      '--- a/src/removed.ts',
      '+++ /dev/null',
      '@@ -1,5 +0,0 @@',
      '-a',
      '-b',
      '-c',
      '-d',
      '-e',
    ].join('\n');

    expect(parseUnifiedDiff(diff)).toEqual([]);
  });

  it('an empty diff → no ranges', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
