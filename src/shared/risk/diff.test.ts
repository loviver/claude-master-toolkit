import { describe, it, expect } from 'vitest';
import { parseFileDiff, parseNameStatus, parseUnifiedDiff } from './diff.js';

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
      { file: 'src/foo.ts', start: 11, end: 13, added: 3, removed: 0 },
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
      { file: 'src/bar.ts', start: 5, end: 5, added: 1, removed: 1 },
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
      { file: 'src/baz.ts', start: 1, end: 2, added: 2, removed: 0 },
      { file: 'src/baz.ts', start: 22, end: 22, added: 1, removed: 1 },
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
      { file: 'src/one.ts', start: 1, end: 1, added: 1, removed: 0 },
      { file: 'src/two.ts', start: 4, end: 5, added: 2, removed: 0 },
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
      { file: 'src/del.ts', start: 23, end: 23, added: 0, removed: 2 },
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

describe('parseFileDiff — one file diff to reviewable hunks', () => {
  it('numbers context, deleted and added lines on their own side', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index abc1234..def5678 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -3,3 +3,3 @@ function foo() {',
      ' keep',
      '-old',
      '+new',
      ' tail',
    ].join('\n');

    expect(parseFileDiff(diff)).toEqual({
      status: 'modified',
      binary: false,
      hunks: [{
        oldStart: 3,
        newStart: 3,
        section: 'function foo() {',
        lines: [
          { kind: 'context', old: 3, new: 3, text: 'keep' },
          { kind: 'del', old: 4, new: null, text: 'old' },
          { kind: 'add', old: null, new: 4, text: 'new' },
          { kind: 'context', old: 5, new: 5, text: 'tail' },
        ],
      }],
    });
  });

  it('a new file is "added" and its lines only have a new side', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/a.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
    ].join('\n');

    const d = parseFileDiff(diff);
    expect(d.status).toBe('added');
    expect(d.hunks[0].lines).toEqual([
      { kind: 'add', old: null, new: 1, text: 'one' },
      { kind: 'add', old: null, new: 2, text: 'two' },
    ]);
  });

  it('a removed file is "deleted"', () => {
    const diff = ['--- a/a.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-gone'].join('\n');
    const d = parseFileDiff(diff);
    expect(d.status).toBe('deleted');
    expect(d.hunks[0].lines).toEqual([{ kind: 'del', old: 1, new: null, text: 'gone' }]);
  });

  it('skips the "no newline" marker and keeps several hunks apart', () => {
    const diff = [
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-a',
      '\\ No newline at end of file',
      '+b',
      '@@ -10 +10 @@',
      '-x',
      '+y',
    ].join('\n');

    const d = parseFileDiff(diff);
    expect(d.hunks).toHaveLength(2);
    expect(d.hunks[0].lines.map((l) => l.text)).toEqual(['a', 'b']);
    expect(d.hunks[1]).toMatchObject({ oldStart: 10, newStart: 10, section: '' });
  });

  it('a binary file has no hunks and says so', () => {
    const diff = ['diff --git a/logo.png b/logo.png', 'Binary files a/logo.png and b/logo.png differ'].join('\n');
    expect(parseFileDiff(diff)).toEqual({ status: 'modified', binary: true, hunks: [] });
  });

  it('an empty diff → no hunks', () => {
    expect(parseFileDiff('')).toEqual({ status: 'modified', binary: false, hunks: [] });
  });
});

describe('parseNameStatus — git status per changed file', () => {
  it('maps A/M/D to added/modified/deleted, renames to modified on the new path, copies to added', () => {
    const text = ['A\tsrc/new.ts', 'M\tsrc/edit.ts', 'D\tsrc/gone.ts', 'R087\tsrc/old.ts\tsrc/moved.ts', 'C100\tsrc/a.ts\tsrc/b.ts', 'T\tsrc/t.ts', ''].join('\n');
    expect(parseNameStatus(text)).toEqual(new Map([
      ['src/new.ts', 'added'],
      ['src/edit.ts', 'modified'],
      ['src/gone.ts', 'deleted'],
      ['src/moved.ts', 'modified'],
      ['src/b.ts', 'added'],
      ['src/t.ts', 'modified'],
    ]));
  });
});
