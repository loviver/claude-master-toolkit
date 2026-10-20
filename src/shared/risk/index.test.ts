import { describe, it, expect } from 'vitest';
import { buildSignals, countPriorBugs } from './index.js';
import type { TouchedSymbol } from './map.js';
import type { TouchedRange } from './diff.js';

const sym = (over: Partial<TouchedSymbol> = {}): TouchedSymbol => ({
  file: 'src/a.ts',
  symbol: 'foo',
  exported: false,
  callers: [],
  range: [1, 10],
  ...over,
});

const range = (file: string, added: number): TouchedRange => ({ file, start: 1, end: added, added });

describe('buildSignals — aggregate touched symbols + ranges into RiskSignals', () => {
  it('no change → all signals zero', () => {
    expect(buildSignals([], [], 0)).toEqual({
      blastRadius: 0,
      maxSymbolCallers: 0,
      publicApi: 0,
      spread: 0,
      churn: 0,
      priorBugs: 0,
    });
  });

  it('counts files (spread) and added lines (churn) off the ranges', () => {
    const s = buildSignals([], [range('src/a.ts', 5), range('src/a.ts', 3), range('src/b.ts', 2)], 0);
    expect(s.spread).toBe(2); // two unique files
    expect(s.churn).toBe(10); // 5 + 3 + 2
  });

  it('publicApi counts exported touched symbols; maxSymbolCallers is the hottest', () => {
    const s = buildSignals(
      [
        sym({ symbol: 'foo', exported: true, callers: ['a', 'b'] }),
        sym({ symbol: 'bar', exported: false, callers: ['c'] }),
      ],
      [],
      0,
    );
    expect(s.publicApi).toBe(1);
    expect(s.maxSymbolCallers).toBe(2);
  });

  it('blastRadius is unique external callers — touched symbols subtracted out', () => {
    // foo called by {a,b}; bar called by {b,foo}. Union {a,b,foo} minus touched {foo,bar} = {a,b}.
    const s = buildSignals(
      [
        sym({ symbol: 'foo', callers: ['a', 'b'] }),
        sym({ symbol: 'bar', callers: ['b', 'foo'] }),
      ],
      [],
      0,
    );
    expect(s.blastRadius).toBe(2);
  });

  it('passes priorBugs through unchanged', () => {
    expect(buildSignals([], [], 3).priorBugs).toBe(3);
  });
});

describe('countPriorBugs — bug findings landing on touched code', () => {
  const touched = [sym({ symbol: 'foo', file: 'src/a.ts' }), sym({ symbol: 'bar', file: 'src/b.ts' })];

  it('matches a finding by symbol or by file; ignores the rest', () => {
    const findings = [
      { symbol: 'foo', file: null }, // symbol hit
      { symbol: null, file: 'src/b.ts' }, // file hit
      { symbol: 'nope', file: 'src/elsewhere.ts' }, // miss
    ];
    expect(countPriorBugs(findings, touched)).toBe(2);
  });

  it('is zero when nothing overlaps', () => {
    expect(countPriorBugs([{ symbol: 'x', file: 'y.ts' }], touched)).toBe(0);
  });
});
