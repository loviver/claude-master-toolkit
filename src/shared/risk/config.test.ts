import { describe, it, expect } from 'vitest';
import { DEFAULT_RISK_CONFIG, validateConfig } from './config.js';
import type { RiskConfig } from './types.js';

describe('validateConfig', () => {
  it('accepts the default config', () => {
    expect(validateConfig(DEFAULT_RISK_CONFIG)).toEqual([]);
  });

  it('flags weights that do not sum to 1', () => {
    const bad: RiskConfig = {
      ...DEFAULT_RISK_CONFIG,
      weights: { ...DEFAULT_RISK_CONFIG.weights, blastRadius: 0.9 },
    };
    expect(validateConfig(bad).some((p) => /sum to 1/.test(p))).toBe(true);
  });

  it('flags a non-positive norm denominator', () => {
    const bad: RiskConfig = {
      ...DEFAULT_RISK_CONFIG,
      norm: { ...DEFAULT_RISK_CONFIG.norm, churn: 0 },
    };
    expect(validateConfig(bad).some((p) => /norm\.churn/.test(p))).toBe(true);
  });

  it('flags tiers out of order (direct ≥ delegate)', () => {
    const bad: RiskConfig = { ...DEFAULT_RISK_CONFIG, tiers: { direct: 0.7, delegate: 0.6 } };
    expect(validateConfig(bad).some((p) => /tiers/.test(p))).toBe(true);
  });

  it('flags callersCritical not above callersHard', () => {
    const bad: RiskConfig = {
      ...DEFAULT_RISK_CONFIG,
      overrides: { callersHard: 50, callersCritical: 20 },
    };
    expect(validateConfig(bad).some((p) => /callersCritical/.test(p))).toBe(true);
  });
});
