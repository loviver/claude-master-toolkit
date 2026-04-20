import { describe, it, expect } from 'vitest';
import { computeNodeWeights, weightToWidth, MIN_NODE_W, MAX_NODE_W } from '../node-weight';
import type { SessionGraphNode } from '../../../lib/types';

function mk(id: string, over: Partial<SessionGraphNode> = {}): SessionGraphNode {
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
  } as SessionGraphNode;
}

describe('computeNodeWeights', () => {
  it('returns empty map for no nodes', () => {
    expect(computeNodeWeights([]).size).toBe(0);
  });

  it('assigns 0.5 to single node (no variance)', () => {
    const w = computeNodeWeights([mk('a', { inputTokens: 100, outputTokens: 50 })]);
    expect(w.get('a')).toBe(0.5);
  });

  it('max-token node weights > min-token node', () => {
    const nodes = [
      mk('small', { inputTokens: 10, outputTokens: 5, tools: [], costUsd: 0.001 }),
      mk('big', { inputTokens: 10_000, outputTokens: 5_000, tools: ['a', 'b', 'c'], costUsd: 0.5 }),
    ];
    const w = computeNodeWeights(nodes);
    expect(w.get('big')!).toBeGreaterThan(w.get('small')!);
    expect(w.get('big')).toBeLessThanOrEqual(1);
    expect(w.get('small')).toBeGreaterThanOrEqual(0);
  });

  it('combines tokens + tools + cost (composite signal)', () => {
    const nodes = [
      mk('tok', { inputTokens: 1000, outputTokens: 0 }),
      mk('tool', { tools: ['a', 'b', 'c', 'd'] }),
      mk('cost', { costUsd: 1 }),
      mk('empty'),
    ];
    const w = computeNodeWeights(nodes);
    expect(w.get('empty')).toBeLessThan(w.get('tok')!);
    expect(w.get('empty')).toBeLessThan(w.get('tool')!);
    expect(w.get('empty')).toBeLessThan(w.get('cost')!);
  });
});

describe('weightToWidth', () => {
  it('maps 0 to MIN_NODE_W and 1 to MAX_NODE_W', () => {
    expect(weightToWidth(0)).toBe(MIN_NODE_W);
    expect(weightToWidth(1)).toBe(MAX_NODE_W);
  });

  it('maps 0.5 to midpoint', () => {
    expect(weightToWidth(0.5)).toBe((MIN_NODE_W + MAX_NODE_W) / 2);
  });

  it('clamps out-of-range values', () => {
    expect(weightToWidth(-1)).toBe(MIN_NODE_W);
    expect(weightToWidth(2)).toBe(MAX_NODE_W);
  });
});
