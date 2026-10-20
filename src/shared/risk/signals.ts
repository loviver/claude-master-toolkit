import type { RiskSignals, ScoredSignalKey } from './types.js';

export interface ScoredSignalDef {
  key: ScoredSignalKey;
  defaultWeight: number;
  defaultNorm: number;
  /** Pull this signal's raw value out of RiskSignals. Code, never JSON. */
  extract: (s: RiskSignals) => number;
}

/**
 * The registry of score-contributing signals. Adding a scored signal means
 * adding a field to `RiskSignals` and one entry here — the scoring loop in
 * `score.ts` never changes (closed for modification, open for extension).
 *
 * `maxSymbolCallers` and `priorBugs` live on RiskSignals but are deliberately
 * NOT here: they drive tier-floor / escalation overrides, never the weighted sum.
 */
export const SCORED_SIGNALS: readonly ScoredSignalDef[] = [
  { key: 'blastRadius', defaultWeight: 0.4, defaultNorm: 20, extract: (s) => s.blastRadius },
  { key: 'publicApi', defaultWeight: 0.25, defaultNorm: 5, extract: (s) => s.publicApi },
  { key: 'spread', defaultWeight: 0.2, defaultNorm: 8, extract: (s) => s.spread },
  { key: 'churn', defaultWeight: 0.15, defaultNorm: 200, extract: (s) => s.churn },
];
