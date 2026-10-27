import { describe, it, expect } from 'vitest';
import {
  aggregateActivity,
  aiHeat,
  toRepoRelative,
  touchesFromSnapshots,
  touchesFromToolCall,
} from '../file-activity';

const ROOT = '/home/u/repo';

describe('touchesFromToolCall', () => {
  it('maps Claude file tools to their operation', () => {
    expect(touchesFromToolCall(1, 'Read', JSON.stringify({ file_path: '/home/u/repo/a.ts' })))
      .toEqual([{ eventId: 1, file: '/home/u/repo/a.ts', op: 'read' }]);
    expect(touchesFromToolCall(1, 'Edit', JSON.stringify({ file_path: 'a.ts' }))[0].op).toBe('edit');
    expect(touchesFromToolCall(1, 'MultiEdit', JSON.stringify({ file_path: 'a.ts' }))[0].op).toBe('edit');
    expect(touchesFromToolCall(1, 'Write', JSON.stringify({ file_path: 'a.ts' }))[0].op).toBe('write');
    expect(touchesFromToolCall(1, 'NotebookEdit', JSON.stringify({ notebook_path: 'n.ipynb' })))
      .toEqual([{ eventId: 1, file: 'n.ipynb', op: 'edit' }]);
  });

  it('reads every file header of an apply_patch (Codex)', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: src/new.ts',
      '+x',
      '*** Update File: src/old.ts',
      '@@',
      '*** Delete File: src/gone.ts',
      '*** End Patch',
    ].join('\n');
    expect(touchesFromToolCall(7, 'apply_patch', JSON.stringify({ input: patch }))).toEqual([
      { eventId: 7, file: 'src/new.ts', op: 'write' },
      { eventId: 7, file: 'src/old.ts', op: 'edit' },
      { eventId: 7, file: 'src/gone.ts', op: 'edit' },
    ]);
  });

  it('falls back to a generic path key as a read for unknown tools', () => {
    expect(touchesFromToolCall(2, 'view_file', JSON.stringify({ path: 'b.ts' })))
      .toEqual([{ eventId: 2, file: 'b.ts', op: 'read' }]);
  });

  it('ignores tools without a file and unparsable (truncated) input', () => {
    expect(touchesFromToolCall(3, 'Bash', JSON.stringify({ command: 'ls' }))).toEqual([]);
    expect(touchesFromToolCall(3, 'Grep', JSON.stringify({ pattern: 'x', path: 'src' }))).toEqual([]);
    expect(touchesFromToolCall(3, 'Edit', '{"file_path":"a.t')).toEqual([]);
    expect(touchesFromToolCall(3, 'Edit', null)).toEqual([]);
  });
});

describe('touchesFromSnapshots', () => {
  it('turns resolved snapshot rows into edits, skipping unresolved turns', () => {
    expect(touchesFromSnapshots([{ eventId: 4, filePath: 'a.ts' }, { eventId: null, filePath: 'b.ts' }]))
      .toEqual([{ eventId: 4, file: 'a.ts', op: 'edit' }]);
  });
});

describe('toRepoRelative', () => {
  it('makes absolute paths inside the project relative', () => {
    expect(toRepoRelative(ROOT, '/home/u/repo/src/a.ts')).toBe('src/a.ts');
    expect(toRepoRelative(`${ROOT}/`, '/home/u/repo/src/a.ts')).toBe('src/a.ts');
  });

  it('keeps relative paths, stripping ./', () => {
    expect(toRepoRelative(ROOT, './src/a.ts')).toBe('src/a.ts');
    expect(toRepoRelative(ROOT, 'src/a.ts')).toBe('src/a.ts');
  });

  it('drops files outside the project', () => {
    expect(toRepoRelative(ROOT, '/home/u/.claude/plans/p.md')).toBeNull();
    expect(toRepoRelative(ROOT, '/home/u/repo-other/a.ts')).toBeNull();
    expect(toRepoRelative(ROOT, '../x.ts')).toBeNull();
  });
});

describe('aggregateActivity', () => {
  const meta = new Map([
    [1, { timestamp: 100, costUsd: 0.1, toolErrors: 0 }],
    [2, { timestamp: 200, costUsd: 0.2, toolErrors: 1 }],
  ]);

  it('groups touches per repo file with per-turn ops, most edited first', () => {
    const files = aggregateActivity(ROOT, [
      { eventId: 1, file: '/home/u/repo/a.ts', op: 'read' },
      { eventId: 2, file: 'a.ts', op: 'edit' },
      { eventId: 2, file: '/home/u/repo/a.ts', op: 'edit' },
      { eventId: 1, file: 'b.ts', op: 'read' },
      { eventId: 1, file: '/elsewhere/c.ts', op: 'edit' },
    ], meta);
    expect(files.map((f) => f.file)).toEqual(['a.ts', 'b.ts']);
    expect(files[0]).toMatchObject({ reads: 1, edits: 1 });
    expect(files[0].turns).toEqual([
      { eventId: 1, timestamp: 100, costUsd: 0.1, toolErrors: 0, ops: ['read'] },
      { eventId: 2, timestamp: 200, costUsd: 0.2, toolErrors: 1, ops: ['edit'] },
    ]);
  });

  it('counts a write as an edit and tolerates turns without metadata', () => {
    const [f] = aggregateActivity(ROOT, [{ eventId: 9, file: 'a.ts', op: 'write' }], new Map());
    expect(f).toMatchObject({ reads: 0, edits: 1 });
    expect(f.turns[0]).toEqual({ eventId: 9, timestamp: 0, costUsd: 0, toolErrors: 0, ops: ['write'] });
  });
});

describe('aiHeat', () => {
  it('weighs edits twice as much as reads', () => {
    const heat = aiHeat([
      { file: 'a.ts', reads: 1, edits: 2, turns: [] },
      { file: 'b.ts', reads: 3, edits: 0, turns: [] },
    ]);
    expect(heat).toEqual(new Map([['a.ts', 5], ['b.ts', 3]]));
  });
});
