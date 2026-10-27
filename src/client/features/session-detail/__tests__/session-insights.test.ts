import { describe, it, expect } from 'vitest';
import { computeSessionInsights } from '../session-insights';
import type { SessionGraphNodeDTO } from '../../../lib/types';

function mk(id: string, over: Partial<SessionGraphNodeDTO> = {}): SessionGraphNodeDTO {
  return {
    id,
    turnIdx: 0,
    model: 'claude-opus-4',
    modelKey: 'opus',
    isSidechain: false,
    phase: 'unknown',
    tools: [],
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheHitPct: 0,
    stopReason: null,
    costUsd: 0,
    parentId: null,
    timestamp: 0,
    ...over,
  } as SessionGraphNodeDTO;
}

describe('computeSessionInsights', () => {
  it('returns zeroed insights for no turns', () => {
    const r = computeSessionInsights([]);
    expect(r.toolErrors).toBe(0);
    expect(r.topTools).toEqual([]);
    expect(r.slowest).toBeNull();
    expect(r.p50DurationMs).toBeNull();
    expect(r.thinkingPct).toBe(0);
  });

  it('aggregates health signals', () => {
    const r = computeSessionInsights([
      mk('a', { toolsErrorCount: 2, stopReason: 'max_tokens' }),
      mk('b', { isApiError: true, isCompactSummary: true }),
      mk('c', { toolsErrorCount: 1 }),
    ]);
    expect(r.toolErrors).toBe(3);
    expect(r.apiErrors).toBe(1);
    expect(r.compactions).toBe(1);
    expect(r.maxTokensStops).toBe(1);
  });

  it('ranks tools by call count, descending', () => {
    const r = computeSessionInsights([
      mk('a', { tools: ['Read', 'Edit'] }),
      mk('b', { tools: ['Edit', 'Bash'] }),
      mk('c', { tools: ['Edit'] }),
    ]);
    expect(r.topTools[0]).toEqual({ name: 'Edit', count: 3 });
    expect(r.topTools).toHaveLength(3);
  });

  it('groups sidechain turns by agent role with cost', () => {
    const r = computeSessionInsights([
      mk('main', { costUsd: 1 }),
      mk('x1', { isSidechain: true, agentRole: 'explorer', costUsd: 0.25 }),
      mk('x2', { isSidechain: true, agentRole: 'explorer', costUsd: 0.25 }),
      mk('y', { isSidechain: true, costUsd: 0.1 }),
    ]);
    expect(r.agents).toEqual([
      { role: 'explorer', turns: 2, costUsd: 0.5 },
      { role: 'sub-agent', turns: 1, costUsd: 0.1 },
    ]);
  });

  it('computes phase share, thinking share and activity counters', () => {
    const r = computeSessionInsights([
      mk('a', { phase: 'exploration', hasThinking: true, filesChangedCount: 2, hooksCount: 1 }),
      mk('b', { phase: 'implementation', webSearchCount: 1, webFetchCount: 2 }),
      mk('c', { phase: 'implementation', filesChangedCount: 1 }),
      mk('d', { phase: 'implementation' }),
    ]);
    expect(r.phases[0]).toEqual({ phase: 'implementation', turns: 3, pct: 75 });
    expect(r.thinkingPct).toBe(25);
    expect(r.filesChanged).toBe(3);
    expect(r.hooks).toBe(1);
    expect(r.webCalls).toBe(3);
  });

  it('finds slowest turn and median latency', () => {
    const r = computeSessionInsights([
      mk('a', { turnIdx: 0, durationMs: 1000 }),
      mk('b', { turnIdx: 1, durationMs: 9000 }),
      mk('c', { turnIdx: 2, durationMs: 3000 }),
      mk('d', { turnIdx: 3, durationMs: null }),
    ]);
    expect(r.slowest).toEqual({ turnIdx: 1, durationMs: 9000 });
    expect(r.p50DurationMs).toBe(3000);
  });
});
