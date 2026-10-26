import { describe, it, expect } from 'vitest';
import { contextBudgetGuard, contextPct } from '../context-budget-guard.js';

describe('contextPct', () => {
  it('integer floor of tokens/limit', () => {
    expect(contextPct(140_000, 200_000)).toBe(70);
    expect(contextPct(1, 0)).toBe(0);
  });
});

describe('contextBudgetGuard', () => {
  const base = { limit: 200_000, model: 'sonnet', warned: [] as string[] };

  it('below 70% => noop', () => {
    expect(contextBudgetGuard({ ...base, tokens: 100_000 }).result).toEqual({ kind: 'noop' });
  });

  it.each([
    [140_000, '70', 'threshold crossed — plan a /compact soon'],
    [170_000, '85', 'HIGH — /compact recommended before next large operation'],
    [190_000, '95', 'CRITICAL — run /compact NOW or risk truncation'],
  ])('%i tokens => level %s', (tokens, level, msg) => {
    const out = contextBudgetGuard({ ...base, tokens, cost: '1.23' });
    expect(out.level).toBe(level);
    const text = (out.result as { text: string }).text;
    expect(text).toContain(`⚠  Context Guardian: ${msg}`);
    expect(text).toContain(`Usage: ${Math.floor((tokens / 200_000) * 100)}% (approx ${tokens} tokens of 200000)`);
    expect(text).toContain('Realized cost: $1.23 (sonnet)');
  });

  it('warns once per level', () => {
    const out = contextBudgetGuard({ ...base, tokens: 140_000, warned: ['70'] });
    expect(out.result).toEqual({ kind: 'noop' });
    expect(out.level).toBeUndefined();
  });

  it('escalating level still warns', () => {
    expect(contextBudgetGuard({ ...base, tokens: 170_000, warned: ['70'] }).level).toBe('85');
  });

  it('omits cost line when unknown', () => {
    const t = (contextBudgetGuard({ ...base, tokens: 140_000 }).result as { text: string }).text;
    expect(t).not.toContain('Realized cost');
  });
});
