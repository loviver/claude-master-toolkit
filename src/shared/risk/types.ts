// ── ODD Risk Scorer — domain types ──
//
// A task's risk is scored from signals derived off the AST index + git diff,
// then mapped to a tier that decides how much process to wrap around it.

export type RiskTier = 'DIRECT' | 'GUARDED' | 'DELEGATE';

/** Raw, un-normalized signals about a change. All counts, never pre-weighted. */
export interface RiskSignals {
  /** Unique external callers across every touched symbol (1-hop blast radius). */
  blastRadius: number;
  /** Highest caller count of any single touched symbol (hot-spot detector). */
  maxSymbolCallers: number;
  /** Touched symbols that are `exported` (public API surface). */
  publicApi: number;
  /** Number of files the diff touches. */
  spread: number;
  /** Lines changed in the diff. */
  churn: number;
  /** Prior `bug` findings recorded against touched symbols/files. */
  priorBugs: number;
}

/** The signals that contribute to the weighted score (vs. override-only signals). */
export type ScoredSignalKey = 'blastRadius' | 'publicApi' | 'spread' | 'churn';

/** Per-signal weight. Keyed so it cannot drift from the scored-signal set. */
export type RiskWeights = Record<ScoredSignalKey, number>;

/** Per-signal saturation denominator — the value at which a dimension is "maxed". */
export type RiskNorm = Record<ScoredSignalKey, number>;

export interface RiskConfig {
  weights: RiskWeights;
  norm: RiskNorm;
  /** Thresholds on the [0,1] score: `< direct` → DIRECT, `< delegate` → GUARDED, else DELEGATE. */
  tiers: { direct: number; delegate: number };
  overrides: {
    /** A single symbol with more callers than this floors the tier at GUARDED. */
    callersHard: number;
    /** A single symbol with more callers than this floors the tier at DELEGATE. */
    callersCritical: number;
  };
}

/**
 * A structured, language-agnostic explanation of one scoring decision. The
 * domain emits these codes; presentation (format.ts) turns them into prose, so
 * the scorer never hard-codes a human language.
 */
export type RiskReason =
  | { code: 'scored'; score: number; tier: RiskTier }
  | { code: 'dominant'; signal: ScoredSignalKey; value: number }
  | { code: 'hotSymbolFloor'; callers: number; floor: RiskTier; from: RiskTier; to: RiskTier }
  | { code: 'priorBugEscalation'; count: number; from: RiskTier; to: RiskTier };

export interface RiskScore {
  /** Weighted, normalized score in [0,1]. */
  score: number;
  tier: RiskTier;
  /** Structured, transparent explanation of why this tier was chosen. */
  rationale: RiskReason[];
}
