import type { ModelPricing, TokenUsage } from './types/index.js';

/**
 * Pricing per 1M tokens (USD) — Claude 4.6 / 4.5 family.
 * Source: https://www.anthropic.com/pricing
 */
const PRICING_TABLE: Record<string, ModelPricing> = {
  opus:   { input: 5,    output: 25,   cacheRead: 0.50,  cacheWrite: 6.25  },
  sonnet: { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75  },
  haiku:  { input: 1,    output: 5,    cacheRead: 0.10,  cacheWrite: 1.25  },
};

/** Aliases that map full model IDs to pricing keys */
const MODEL_ALIASES: Record<string, string> = {
  'claude-opus-4-7': 'opus',
  'claude-opus-4-6': 'opus',
  'claude-opus-4-5': 'opus',
  'claude-sonnet-4-6': 'sonnet',
  'claude-sonnet-4-5': 'sonnet',
  'claude-sonnet-4-5-20241022': 'sonnet',
  'claude-haiku-4-5': 'haiku',
  'claude-haiku-4-5-20251001': 'haiku',
};

export function resolveModelKey(model: string): string {
  if (PRICING_TABLE[model]) return model;
  if (MODEL_ALIASES[model]) return MODEL_ALIASES[model];

  // Heuristic: match by substring
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('haiku')) return 'haiku';

  return 'sonnet'; // fallback
}

export function getPricing(model: string): ModelPricing {
  const key = resolveModelKey(model);
  return PRICING_TABLE[key] ?? PRICING_TABLE['sonnet'];
}

export function computeCost(model: string, tokens: TokenUsage): number {
  const p = getPricing(model);
  return (
    (tokens.inputTokens * p.input +
      tokens.outputTokens * p.output +
      tokens.cacheReadTokens * p.cacheRead +
      tokens.cacheCreationTokens * p.cacheWrite) /
    1_000_000
  );
}

export function getAllPricing(): Record<string, ModelPricing> {
  return { ...PRICING_TABLE };
}
