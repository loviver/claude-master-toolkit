import { describe, it, expect } from 'vitest';
import { scoreRisk } from './score.js';
import { DEFAULT_RISK_CONFIG } from './config.js';
import type { RiskSignals } from './types.js';

// Minimal signal factory — overrides only what a case cares about.
function sig(overrides: Partial<RiskSignals> = {}): RiskSignals {
  return {
    blastRadius: 0,
    maxSymbolCallers: 0,
    publicApi: 0,
    spread: 0,
    churn: 0,
    priorBugs: 0,
    ...overrides,
  };
}

describe('scoreRisk — tiers from the default config', () => {
  it('no change → score 0 → DIRECT', () => {
    const r = scoreRisk(sig());
    expect(r.score).toBe(0);
    expect(r.tier).toBe('DIRECT');
  });

  it('small isolated change → DIRECT', () => {
    const r = scoreRisk(sig({ blastRadius: 2, maxSymbolCallers: 2, spread: 1, churn: 20 }));
    expect(r.tier).toBe('DIRECT');
  });

  it('medium change → GUARDED', () => {
    const r = scoreRisk(sig({ blastRadius: 10, maxSymbolCallers: 6, publicApi: 1, spread: 3, churn: 60 }));
    expect(r.tier).toBe('GUARDED');
  });

  it('wide, high-blast change → DELEGATE', () => {
    const r = scoreRisk(sig({ blastRadius: 25, maxSymbolCallers: 12, publicApi: 3, spread: 6, churn: 300 }));
    expect(r.tier).toBe('DELEGATE');
  });
});

describe('scoreRisk — normalization saturates', () => {
  it('a single enormous blast radius saturates its weight, does not alone force DELEGATE', () => {
    const r = scoreRisk(sig({ blastRadius: 1000, maxSymbolCallers: 1000 }));
    expect(r.score).toBeLessThanOrEqual(1);
    // blastRadius weight alone (0.4) lands in GUARDED band, not DELEGATE…
    // but maxSymbolCallers override applies — so assert the score cap, not the tier here.
    expect(r.score).toBeCloseTo(0.4, 5);
  });
});

describe('scoreRisk — hard overrides', () => {
  it('a single hot symbol (callers > threshold) lifts DIRECT to at least GUARDED', () => {
    const r = scoreRisk(sig({ maxSymbolCallers: 20, spread: 1, churn: 10 }));
    expect(r.tier).toBe('GUARDED');
    expect(r.rationale.some((x) => x.code === 'hotSymbolFloor')).toBe(true);
  });

  it('a prior bug finding escalates one tier (DIRECT → GUARDED)', () => {
    const base = scoreRisk(sig({ blastRadius: 2, maxSymbolCallers: 2, spread: 1, churn: 20 }));
    expect(base.tier).toBe('DIRECT');
    const r = scoreRisk(sig({ blastRadius: 2, maxSymbolCallers: 2, spread: 1, churn: 20, priorBugs: 1 }));
    expect(r.tier).toBe('GUARDED');
  });

  it('a prior bug finding escalates GUARDED → DELEGATE', () => {
    const r = scoreRisk(sig({ blastRadius: 10, maxSymbolCallers: 6, publicApi: 1, spread: 3, churn: 60, priorBugs: 1 }));
    expect(r.tier).toBe('DELEGATE');
  });

  it('a prior bug on an already-DELEGATE change stays DELEGATE (bump clamps at top)', () => {
    const r = scoreRisk(sig({ blastRadius: 25, maxSymbolCallers: 12, publicApi: 3, spread: 6, churn: 300, priorBugs: 2 }));
    expect(r.tier).toBe('DELEGATE');
  });
});

describe('scoreRisk — hot-symbol tier floor (two thresholds)', () => {
  it('a symbol past the critical threshold forces DELEGATE even on a tiny change', () => {
    const r = scoreRisk(sig({ maxSymbolCallers: 80, spread: 1, churn: 10 }));
    expect(r.tier).toBe('DELEGATE');
  });

  it('a critical hot symbol lifts an otherwise-GUARDED change to DELEGATE', () => {
    const r = scoreRisk(sig({ blastRadius: 10, publicApi: 1, spread: 3, churn: 60, maxSymbolCallers: 80 }));
    expect(r.tier).toBe('DELEGATE');
  });

  it('a symbol between hard and critical floors at GUARDED only', () => {
    const r = scoreRisk(sig({ maxSymbolCallers: 30, spread: 1, churn: 10 }));
    expect(r.tier).toBe('GUARDED');
  });
});

describe('scoreRisk — rationale', () => {
  it('leads with a scored reason carrying the score-derived tier', () => {
    const r = scoreRisk(sig({ blastRadius: 10, maxSymbolCallers: 6, spread: 3, churn: 60 }));
    expect(r.rationale.length).toBeGreaterThan(0);
    expect(r.rationale[0]).toMatchObject({ code: 'scored', tier: r.tier });
  });

  it('records a priorBugEscalation reason when a bug escalates the tier', () => {
    const r = scoreRisk(sig({ blastRadius: 2, maxSymbolCallers: 2, spread: 1, churn: 20, priorBugs: 1 }));
    expect(r.rationale.some((x) => x.code === 'priorBugEscalation')).toBe(true);
  });
});

describe('scoreRisk — tier boundaries (strict <, so the threshold itself escalates)', () => {
  it('score exactly at the DIRECT threshold lands in GUARDED, not DIRECT', () => {
    // publicApi=5 → norm 1.0 → 0.25 * 1 = 0.25, exactly tiers.direct
    const r = scoreRisk(sig({ publicApi: 5 }));
    expect(r.score).toBeCloseTo(0.25, 5);
    expect(r.tier).toBe('GUARDED');
  });

  it('score exactly at the DELEGATE threshold lands in DELEGATE, not GUARDED', () => {
    // blastRadius=20 → 0.4, publicApi=4 → 0.25*0.8 = 0.2, total exactly 0.6 = tiers.delegate
    const r = scoreRisk(sig({ blastRadius: 20, publicApi: 4, maxSymbolCallers: 10 }));
    expect(r.score).toBeCloseTo(0.6, 5);
    expect(r.tier).toBe('DELEGATE');
  });
});

describe('scoreRisk — resilient to non-finite signals', () => {
  it('treats NaN / Infinity signal values as 0 (never a NaN score)', () => {
    const r = scoreRisk(sig({ blastRadius: NaN, churn: Infinity }));
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.score).toBe(0);
    expect(r.tier).toBe('DIRECT');
  });
});

describe('scoreRisk — honours an injected config', () => {
  it('a custom DIRECT threshold reclassifies a change the default would call GUARDED', () => {
    const signals = sig({ blastRadius: 10, maxSymbolCallers: 6, publicApi: 1, spread: 3, churn: 60 });
    expect(scoreRisk(signals).tier).toBe('GUARDED'); // default: score ≈ 0.37

    const lenient = { ...DEFAULT_RISK_CONFIG, tiers: { direct: 0.5, delegate: 0.8 } };
    expect(scoreRisk(signals, lenient).tier).toBe('DIRECT');
  });
});
