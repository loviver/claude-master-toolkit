import { describe, it, expect } from 'vitest';
import { computeSessionStats } from '../useSessionStats';
import type { SessionDetail } from '../../lib/types';

function makeSession(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 's1',
    projectPath: '/p',
    startedAt: 0,
    lastActiveAt: 60_000,
    primaryModel: 'claude-opus',
    primaryModelKey: 'opus',
    turnCount: 2,
    sidechainTurns: 0,
    toolCount: 0,
    dominantPhase: 'implementation',
    models: [],
    tokens: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 300, cacheCreationTokens: 0 },
    costUsd: 1,
    events: [],
    modelBreakdown: {},
    ...over,
  } as SessionDetail;
}

describe('computeSessionStats', () => {
  it('computes duration, turnsPerHour, cacheHit, costPerTurn', () => {
    const s = computeSessionStats(makeSession());
    expect(s.durationMs).toBe(60_000);
    expect(s.turnsPerHour).toBe(120);
    expect(s.cacheHitPct).toBeCloseTo((300 / 400) * 100, 2);
    expect(s.costPerTurn).toBe(0.5);
  });

  it('handles zero duration / zero turns safely', () => {
    const s = computeSessionStats(makeSession({ lastActiveAt: 0, turnCount: 0 }));
    expect(s.turnsPerHour).toBe(0);
    expect(s.costPerTurn).toBe(1);
  });

  it('cacheHit is 0 when no input and no cache reads', () => {
    const s = computeSessionStats(
      makeSession({ tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } }),
    );
    expect(s.cacheHitPct).toBe(0);
  });
});
