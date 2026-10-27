import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildLiteLLMTable,
  buildContextTable,
  applyLiteLLMTable,
  getModelInfo,
  computeCost,
  resolveModelKey,
} from '../pricing.js';

const RAW = {
  'claude-sonnet-4-6': { input_cost_per_token: 3e-6, output_cost_per_token: 15e-6, max_input_tokens: 200000 },
  'gpt-5': {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 10e-6,
    cache_read_input_token_cost: 0.125e-6,
    max_input_tokens: 272000,
  },
  'o3': { input_cost_per_token: 2e-6, output_cost_per_token: 8e-6 },
  'gemini-2.5-pro': { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 },
};

beforeEach(() => applyLiteLLMTable(buildLiteLLMTable(RAW), buildContextTable(RAW)));

describe('buildLiteLLMTable', () => {
  it('keeps claude and OpenAI models, drops other providers', () => {
    const t = buildLiteLLMTable(RAW);
    expect(Object.keys(t).sort()).toEqual(['claude-sonnet-4-6', 'gpt-5', 'o3']);
    expect(t['gpt-5']).toEqual({ input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 });
  });
});

describe('getModelInfo', () => {
  it('known claude model', () => {
    const i = getModelInfo('claude-sonnet-4-6');
    expect(i).toMatchObject({ key: 'sonnet', family: 'anthropic', known: true });
    expect(i.pricing?.input).toBe(3);
    expect(i.contextWindow).toBe(200000);
  });

  it('known OpenAI model from LiteLLM', () => {
    const i = getModelInfo('gpt-5');
    expect(i).toMatchObject({ key: 'gpt-5', family: 'openai', known: true });
    expect(i.pricing?.output).toBe(10);
    expect(i.contextWindow).toBe(272000);
  });

  it('unknown model is NOT silently priced as sonnet', () => {
    const i = getModelInfo('gpt-6-luna');
    expect(i).toMatchObject({ key: 'unknown', known: false, pricing: null, contextWindow: null });
    expect(i.family).toBe('openai');
  });

  it('totally unknown family', () => {
    expect(getModelInfo('mystery-9')).toMatchObject({ key: 'unknown', family: 'unknown', known: false });
  });
});

describe('resolveModelKey', () => {
  it('no sonnet fallback for unknown models', () => {
    expect(resolveModelKey('mystery-9')).toBe('unknown');
    expect(resolveModelKey('gpt-6-luna')).toBe('unknown');
  });
  it('still resolves claude tiers and known ids', () => {
    expect(resolveModelKey('claude-opus-4-7')).toBe('opus');
    expect(resolveModelKey('gpt-5')).toBe('gpt-5');
  });
});

describe('computeCost', () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheCreationTokens: 0 };
  it('prices a known OpenAI model', () => {
    expect(computeCost('gpt-5', usage)).toBeCloseTo(1.25 + 10 + 0.125, 6);
  });
  it('unknown model costs 0 instead of a sonnet guess', () => {
    expect(computeCost('gpt-6-luna', usage)).toBe(0);
  });
});
