import { describe, it, expect } from 'vitest';
import { computeTokenTotals } from '../aggregators/token-totals.js';
import { computeTotalCost } from '../aggregators/cost-total.js';
import type { EnrichedTokenEventData } from '../../../shared/types/token-event.js';

const base: EnrichedTokenEventData = {
  uuid: 'a',
  timestamp: '2024-01-01T00:00:00Z',
  model: 'claude-3-5-haiku-20241022',
  usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 5 },
  toolsUsed: [],
  stopReason: 'end_turn',
  isSidechain: false,
  semanticPhase: 'unknown',
};

describe('computeTokenTotals', () => {
  it('sums zero events', () => {
    expect(computeTokenTotals([])).toEqual({
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
    });
  });

  it('sums single event', () => {
    const result = computeTokenTotals([base]);
    expect(result).toEqual({
      inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 5,
    });
  });

  it('sums multiple events', () => {
    const second = { ...base, usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 } };
    const result = computeTokenTotals([base, second]);
    expect(result).toEqual({
      inputTokens: 300, outputTokens: 150, cacheReadTokens: 10, cacheCreationTokens: 5,
    });
  });
});

describe('computeTotalCost', () => {
  it('returns 0 for empty events', () => {
    expect(computeTotalCost([])).toBe(0);
  });

  it('returns a non-negative number for known model', () => {
    const cost = computeTotalCost([base]);
    expect(cost).toBeGreaterThanOrEqual(0);
    expect(typeof cost).toBe('number');
  });

  it('accumulates cost across multiple events', () => {
    const costSingle = computeTotalCost([base]);
    const costDouble = computeTotalCost([base, base]);
    expect(costDouble).toBeCloseTo(costSingle * 2, 10);
  });
});
