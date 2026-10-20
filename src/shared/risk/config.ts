import type { RiskConfig, RiskNorm, RiskWeights } from './types.js';
import { SCORED_SIGNALS } from './signals.js';

const weightsFromRegistry = (): RiskWeights =>
  Object.fromEntries(SCORED_SIGNALS.map((d) => [d.key, d.defaultWeight])) as RiskWeights;

const normFromRegistry = (): RiskNorm =>
  Object.fromEntries(SCORED_SIGNALS.map((d) => [d.key, d.defaultNorm])) as RiskNorm;

/**
 * Default risk weights/thresholds, derived from the signal registry so they
 * can never drift out of sync with `SCORED_SIGNALS`. Tunable — Phase 2 loads
 * `.ctk/risk.json` overrides on top of these. Weights sum to 1 so the raw
 * score lands in [0,1].
 */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  weights: weightsFromRegistry(),
  norm: normFromRegistry(),
  tiers: { direct: 0.25, delegate: 0.6 },
  overrides: { callersHard: 15, callersCritical: 50 },
};

/**
 * Check a config for internal consistency. Returns a list of problems (empty =
 * valid) rather than throwing — the caller (e.g. the `.ctk/risk.json` loader)
 * decides whether to warn, fall back to defaults, or abort. The scorer itself
 * never validates, so an advisory read never crashes on a bad config.
 */
export function validateConfig(config: RiskConfig): string[] {
  const problems: string[] = [];

  const weightSum = Object.values(config.weights).reduce((a, b) => a + b, 0);
  if (Math.abs(weightSum - 1) > 1e-6) {
    problems.push(`weights must sum to 1 (got ${weightSum})`);
  }

  for (const [key, denom] of Object.entries(config.norm)) {
    if (!(denom > 0)) problems.push(`norm.${key} must be > 0 (got ${denom})`);
  }

  const { direct, delegate } = config.tiers;
  if (!(direct > 0 && direct < delegate && delegate <= 1)) {
    problems.push(`tiers must satisfy 0 < direct < delegate ≤ 1 (got direct=${direct}, delegate=${delegate})`);
  }

  const { callersHard, callersCritical } = config.overrides;
  if (!(callersHard > 0)) problems.push(`overrides.callersHard must be > 0 (got ${callersHard})`);
  if (!(callersCritical > callersHard)) {
    problems.push(`overrides.callersCritical must be > callersHard (got ${callersCritical} vs ${callersHard})`);
  }

  return problems;
}
