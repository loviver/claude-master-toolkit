import { describe, it, expect } from 'vitest';
import { buildTokenTimelineData } from '../useTokenTimelineData';
import type { TokenEvent } from '../../lib/types';

function ev(i: number, model: string, over: Partial<TokenEvent> = {}): TokenEvent {
  return {
    id: i,
    sessionId: 's',
    timestamp: i * 1000,
    model,
    modelKey: 'opus',
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 2,
    cacheCreationTokens: 1,
    costUsd: 0.001,
    toolsUsed: [],
    isSidechain: false,
    ...over,
  } as TokenEvent;
}

describe('buildTokenTimelineData', () => {
  it('returns empty-shape for no events', () => {
    const r = buildTokenTimelineData([]);
    expect(r.data).toEqual([]);
    expect(r.segments).toEqual([]);
    expect(r.uniqueModels).toEqual([]);
  });

  it('collapses consecutive same-model events into one segment', () => {
    const r = buildTokenTimelineData([ev(1, 'opus'), ev(2, 'opus'), ev(3, 'sonnet')]);
    expect(r.segments).toEqual([
      { model: 'opus', start: 0, end: 1 },
      { model: 'sonnet', start: 2, end: 2 },
    ]);
    expect(r.uniqueModels).toEqual(['opus', 'sonnet']);
    expect(r.data.length).toBe(3);
    expect(r.data[0].turn).toBe(1);
  });
});
