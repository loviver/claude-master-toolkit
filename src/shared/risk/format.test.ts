import { describe, it, expect } from 'vitest';
import { formatReason, formatRationale } from './format.js';

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
