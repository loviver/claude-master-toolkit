import { describe, expect, it } from 'vitest';
import { costShare, modelMix, turnSeries } from '../session-preview-model';

describe('turnSeries', () => {
  it('orders turns by index and keeps tokens and phase', () => {
    const nodes = [
      { turnIdx: 2, tokens: 30, phase: 'testing' as const },
      { turnIdx: 0, tokens: 10, phase: 'exploration' as const },
      { turnIdx: 1, tokens: 20, phase: 'implementation' as const },
    ];
    expect(turnSeries(nodes)).toEqual({
      tokens: [10, 20, 30],
      phases: ['exploration', 'implementation', 'testing'],
    });
  });
});

describe('modelMix', () => {
  it('splits by cost, largest first', () => {
    const mix = modelMix([
      { model: 'a', modelKey: 'haiku', turns: 9, costUsd: 1 },
      { model: 'b', modelKey: 'opus', turns: 1, costUsd: 3 },
    ]);
    expect(mix.map((m) => [m.modelKey, m.share])).toEqual([['opus', 0.75], ['haiku', 0.25]]);
  });

  it('falls back to turns when nothing cost anything', () => {
    const mix = modelMix([
      { model: 'a', modelKey: 'sonnet', turns: 1, costUsd: 0 },
      { model: 'b', modelKey: 'haiku', turns: 3, costUsd: 0 },
    ]);
    expect(mix.map((m) => m.share)).toEqual([0.75, 0.25]);
  });

  it('is empty without models', () => {
    expect(modelMix([])).toEqual([]);
  });
});

describe('costShare', () => {
  it('scales cost against the most expensive session, clamped to [0, 1]', () => {
    expect(costShare(5, 10)).toBe(0.5);
    expect(costShare(20, 10)).toBe(1);
    expect(costShare(3, 0)).toBe(0);
  });
});
