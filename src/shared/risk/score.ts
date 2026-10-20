import type { RiskConfig, RiskReason, RiskScore, RiskSignals, RiskTier } from './types.js';
import { DEFAULT_RISK_CONFIG } from './config.js';
import { SCORED_SIGNALS } from './signals.js';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Normalize a raw signal against its saturation denominator, clamped to [0,1].
 * Non-finite inputs (NaN/Infinity) or a non-positive denominator yield 0 — a bad
 * signal must never poison the score.
 */
const norm = (value: number, denom: number): number =>
  Number.isFinite(value) && Number.isFinite(denom) && denom > 0 ? clamp01(value / denom) : 0;

const TIER_ORDER: readonly RiskTier[] = ['DIRECT', 'GUARDED', 'DELEGATE'];

/** Escalate a tier by one step, clamped at DELEGATE. */
function bumpTier(tier: RiskTier): RiskTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, i + 1)];
}

/** The higher (more cautious) of two tiers. */
function maxTier(a: RiskTier, b: RiskTier): RiskTier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

/** Tier floor implied by a single symbol's caller count. */
function floorFromHotSymbol(callers: number, config: RiskConfig): RiskTier {
  if (callers > config.overrides.callersCritical) return 'DELEGATE';
  if (callers > config.overrides.callersHard) return 'GUARDED';
  return 'DIRECT';
}

/**
 * Pure risk scorer. Signals in → score + tier + rationale out. No IO.
 *
 * Score is a weighted sum of normalized signals (blast radius, public API,
 * spread, churn). Two hard overrides sit on top of the numeric tier:
 *   1. a single hot symbol floors the tier — GUARDED past callersHard, DELEGATE
 *      past callersCritical;
 *   2. any prior bug finding on touched code escalates one tier.
 */
export function scoreRisk(signals: RiskSignals, config: RiskConfig = DEFAULT_RISK_CONFIG): RiskScore {
  // Iterate the signal registry — the scoring algorithm is closed for
  // modification; new signals extend SCORED_SIGNALS, never this loop.
  const contrib = SCORED_SIGNALS.map((def) => ({
    key: def.key,
    value: config.weights[def.key] * norm(def.extract(signals), config.norm[def.key]),
  }));

  const score = clamp01(contrib.reduce((acc, c) => acc + c.value, 0));

  let tier: RiskTier =
    score < config.tiers.direct ? 'DIRECT' : score < config.tiers.delegate ? 'GUARDED' : 'DELEGATE';

  // `scored` captures the score-derived tier before overrides move it.
  const rationale: RiskReason[] = [{ code: 'scored', score, tier }];

  const dominant = [...contrib].sort((a, b) => b.value - a.value)[0];
  if (dominant && dominant.value > 0) {
    rationale.push({ code: 'dominant', signal: dominant.key, value: signals[dominant.key] });
  }

  // Override 1 — a single heavily-called symbol sets a tier FLOOR regardless of
  // score: GUARDED past callersHard, DELEGATE past callersCritical.
  const hotFloor = floorFromHotSymbol(signals.maxSymbolCallers, config);
  const floored = maxTier(tier, hotFloor);
  if (floored !== tier) {
    rationale.push({ code: 'hotSymbolFloor', callers: signals.maxSymbolCallers, floor: hotFloor, from: tier, to: floored });
    tier = floored;
  }

  // Override 2 — touching code with a known bug history always escalates.
  if (signals.priorBugs > 0) {
    const before = tier;
    tier = bumpTier(tier);
    if (tier !== before) {
      rationale.push({ code: 'priorBugEscalation', count: signals.priorBugs, from: before, to: tier });
    }
  }

  return { score, tier, rationale };
}
