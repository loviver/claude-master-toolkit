import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ModelPricing, TokenUsage } from './types/index.js';

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const CACHE_DIR = join(homedir(), '.cache', 'ctk');
const CACHE_FILE = join(CACHE_DIR, 'litellm-pricing.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Hardcoded fallback — per 1M tokens (USD) */
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  opus:   { input: 5,    output: 25,   cacheRead: 0.50,  cacheWrite: 6.25  },
  sonnet: { input: 3,    output: 15,   cacheRead: 0.30,  cacheWrite: 3.75  },
  haiku:  { input: 1,    output: 5,    cacheRead: 0.10,  cacheWrite: 1.25  },
};

/** Aliases that map full model IDs to tier keys */
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

// Mutable in-memory table — starts as fallback, refreshed async
let PRICING_TABLE: Record<string, ModelPricing> = { ...FALLBACK_PRICING };
// Full model-id → pricing from LiteLLM (populated after refresh)
let LITELLM_TABLE: Record<string, ModelPricing> = {};

// ---------------------------------------------------------------------------
// Disk cache helpers
// ---------------------------------------------------------------------------

interface DiskCache {
  fetchedAt: number;
  litellmTable: Record<string, ModelPricing>;
}

function readDiskCache(): DiskCache | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const raw = readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(raw) as DiskCache;
  } catch {
    return null;
  }
}

function writeDiskCache(data: DiskCache): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8');
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// LiteLLM JSON → ModelPricing mapper
// ---------------------------------------------------------------------------

type LiteLLMEntry = {
  litellm_provider?: string;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
};

function mapLiteLLMEntry(e: LiteLLMEntry): ModelPricing | null {
  if (!e.input_cost_per_token || !e.output_cost_per_token) return null;
  return {
    input:       e.input_cost_per_token       * 1_000_000,
    output:      e.output_cost_per_token      * 1_000_000,
    cacheRead:   (e.cache_read_input_token_cost      ?? 0) * 1_000_000,
    cacheWrite:  (e.cache_creation_input_token_cost  ?? 0) * 1_000_000,
  };
}

function buildLiteLLMTable(raw: Record<string, unknown>): Record<string, ModelPricing> {
  const table: Record<string, ModelPricing> = {};
  for (const [model, entry] of Object.entries(raw)) {
    if (!model.startsWith('claude-')) continue;
    const mapped = mapLiteLLMEntry(entry as LiteLLMEntry);
    if (mapped) table[model] = mapped;
  }
  return table;
}

function applyLiteLLMTable(table: Record<string, ModelPricing>): void {
  LITELLM_TABLE = table;
  // Rebuild tier table from live data using heuristic matching
  const tiers: Record<string, ModelPricing> = {};
  for (const [model, pricing] of Object.entries(table)) {
    if (model.includes('opus'))   tiers['opus']   = pricing;
    if (model.includes('sonnet')) tiers['sonnet'] = pricing;
    if (model.includes('haiku'))  tiers['haiku']  = pricing;
  }
  // Only replace tiers we actually found
  for (const tier of ['opus', 'sonnet', 'haiku'] as const) {
    if (tiers[tier]) PRICING_TABLE[tier] = tiers[tier];
  }
}

// ---------------------------------------------------------------------------
// Boot: load disk cache if fresh
// ---------------------------------------------------------------------------

const cached = readDiskCache();
if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
  applyLiteLLMTable(cached.litellmTable);
}

// ---------------------------------------------------------------------------
// Public async refresh
// ---------------------------------------------------------------------------

export async function refreshPricingFromLiteLLM(): Promise<void> {
  try {
    const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const raw = (await res.json()) as Record<string, unknown>;
    const table = buildLiteLLMTable(raw);
    applyLiteLLMTable(table);
    writeDiskCache({ fetchedAt: Date.now(), litellmTable: table });
  } catch {
    // silently fall back to hardcoded / cached values
  }
}

// ---------------------------------------------------------------------------
// Sync public API (unchanged signatures)
// ---------------------------------------------------------------------------

export function resolveModelKey(model: string): string {
  // Exact LiteLLM match first
  if (LITELLM_TABLE[model]) return model;
  if (PRICING_TABLE[model]) return model;
  if (MODEL_ALIASES[model]) return MODEL_ALIASES[model];

  if (model.includes('opus'))   return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('haiku'))  return 'haiku';

  return 'sonnet';
}

export function getPricing(model: string): ModelPricing {
  // Prefer exact LiteLLM entry, then tier table
  if (LITELLM_TABLE[model]) return LITELLM_TABLE[model];
  const key = resolveModelKey(model);
  return PRICING_TABLE[key] ?? PRICING_TABLE['sonnet'];
}

export function computeCost(model: string, tokens: TokenUsage): number {
  const p = getPricing(model);
  return (
    (tokens.inputTokens        * p.input +
     tokens.outputTokens       * p.output +
     tokens.cacheReadTokens    * p.cacheRead +
     tokens.cacheCreationTokens * p.cacheWrite) /
    1_000_000
  );
}

export function getAllPricing(): Record<string, ModelPricing> {
  return { ...PRICING_TABLE };
}
