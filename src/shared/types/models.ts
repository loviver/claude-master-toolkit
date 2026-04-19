import type { TokenUsage } from './base.js';

// ── Model aliases ──

export type ModelAlias = 'opus' | 'sonnet' | 'haiku';

// ── Model preference routing ──

export type ModelPreference = 'inherit' | 'auto' | 'smart' | ModelAlias | `pinned:${string}`;

// ── Pricing per model ──

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// ── Cost breakdown by model ──

export interface CostBreakdown {
  model: string;
  tokens: TokenUsage;
  costUsd: number;
  windowUsagePct: number;
}
