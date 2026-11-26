import { describe, it, expect } from 'vitest';
import { formatReason, formatRationale, riskNotes } from './format.js';

describe('formatReason', () => {
  it('formats a scored reason with 2-decimal score', () => {
    expect(formatReason({ code: 'scored', score: 0.37, tier: 'GUARDED' })).toBe('score 0.37 → GUARDED');
  });

  it('formats a dominant signal', () => {
    expect(formatReason({ code: 'dominant', signal: 'blastRadius', value: 10 })).toContain('blastRadius');
  });

  it('formats a hot-symbol floor with the caller count', () => {
    const s = formatReason({ code: 'hotSymbolFloor', callers: 80, floor: 'DELEGATE', from: 'GUARDED', to: 'DELEGATE' });
    expect(s).toContain('80 callers');
    expect(s).toContain('DELEGATE');
  });

  it('formats a prior-bug escalation', () => {
    expect(formatReason({ code: 'priorBugEscalation', count: 1, from: 'DIRECT', to: 'GUARDED' })).toContain('+1 tier');
  });
});

describe('formatRationale', () => {
  it('maps every reason to a line', () => {
    const lines = formatRationale([
      { code: 'scored', score: 0.1, tier: 'DIRECT' },
      { code: 'dominant', signal: 'churn', value: 20 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('DIRECT');
  });
});

describe('riskNotes — say when a DIRECT read measured nothing', () => {
  const range = { file: 'src/a.ts', start: 1, end: 3, added: 3, removed: 0 };

  it('an empty diff says there is nothing to measure', () => {
    expect(riskNotes({ base: 'dev', ranges: [], touched: [], worktree: false, indexed: true })).toEqual([
      'No changes vs dev (committed only; drop --committed to include uncommitted edits)',
    ]);
    expect(riskNotes({ base: 'dev', ranges: [], touched: [], worktree: true, indexed: true })).toEqual(['No changes vs dev']);
  });

  it('changed lines with zero symbols hint a stale index', () => {
    expect(riskNotes({ base: 'dev', ranges: [range], touched: [], worktree: true, indexed: true })).toEqual([
      '1 file(s) changed but 0 indexed symbols touched: the index may be stale (run `ctk index build`)',
    ]);
  });

  it('a project with no index says so instead of a misleading score', () => {
    expect(riskNotes({ base: 'dev', ranges: [range], touched: [], worktree: true, indexed: false })).toEqual([
      'project is not indexed: only diff size was measured (run `ctk index build`)',
    ]);
  });

  it('a docs-only change maps to no symbols and is not flagged', () => {
    const doc = { ...range, file: 'README.md' };
    expect(riskNotes({ base: 'dev', ranges: [doc], touched: [], worktree: true, indexed: true })).toEqual([]);
  });

  it('a normal read has no notes', () => {
    const touched = [{ file: 'src/a.ts', symbol: 'a', exported: true, callers: [], deps: [], range: [1, 3] as [number, number] }];
    expect(riskNotes({ base: 'dev', ranges: [range], touched, worktree: true, indexed: true })).toEqual([]);
  });
});
