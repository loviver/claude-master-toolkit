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
// Full model-id → max input tokens from LiteLLM
let CONTEXT_TABLE: Record<string, number> = {};

const ANTHROPIC_DEFAULT_CONTEXT = 200_000;
const ANTHROPIC_1M_CONTEXT = 1_000_000;
const TIERS = ['opus', 'sonnet', 'haiku'] as const;

// ---------------------------------------------------------------------------
// Disk cache helpers
// ---------------------------------------------------------------------------

interface DiskCache {
  fetchedAt: number;
  litellmTable: Record<string, ModelPricing>;
  contextTable?: Record<string, number>;
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
  max_input_tokens?: number;
};

/** Model ids ctk prices: Anthropic + OpenAI (GPT / o-series / Codex). */
const PRICED_MODEL = /^(claude-|gpt-|o\d|codex)/;
const OPENAI_MODEL = /^(gpt-|o\d|codex)/;

function mapLiteLLMEntry(e: LiteLLMEntry): ModelPricing | null {
  if (!e.input_cost_per_token || !e.output_cost_per_token) return null;
  return {
    input:       e.input_cost_per_token       * 1_000_000,
    output:      e.output_cost_per_token      * 1_000_000,
    cacheRead:   (e.cache_read_input_token_cost      ?? 0) * 1_000_000,
    cacheWrite:  (e.cache_creation_input_token_cost  ?? 0) * 1_000_000,
  };
}

export function buildLiteLLMTable(raw: Record<string, unknown>): Record<string, ModelPricing> {
  const table: Record<string, ModelPricing> = {};
  for (const [model, entry] of Object.entries(raw)) {
    if (!PRICED_MODEL.test(model)) continue;
    const mapped = mapLiteLLMEntry(entry as LiteLLMEntry);
    if (mapped) table[model] = mapped;
  }
  return table;
}

export function buildContextTable(raw: Record<string, unknown>): Record<string, number> {
  const table: Record<string, number> = {};
  for (const [model, entry] of Object.entries(raw)) {
    if (!PRICED_MODEL.test(model)) continue;
    const n = (entry as LiteLLMEntry).max_input_tokens;
    if (typeof n === 'number' && n > 0) table[model] = n;
  }
  return table;
}

export function applyLiteLLMTable(
  table: Record<string, ModelPricing>,
  contextTable: Record<string, number> = {},
): void {
  LITELLM_TABLE = table;
  CONTEXT_TABLE = contextTable;
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
  applyLiteLLMTable(cached.litellmTable, cached.contextTable);
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
    const contextTable = buildContextTable(raw);
    applyLiteLLMTable(table, contextTable);
    writeDiskCache({ fetchedAt: Date.now(), litellmTable: table, contextTable });
  } catch {
    // silently fall back to hardcoded / cached values
  }
}

// ---------------------------------------------------------------------------
// Sync public API (unchanged signatures)
// ---------------------------------------------------------------------------

const isAnthropic = (m: string): boolean =>
  m.startsWith('claude') || TIERS.some((t) => m.startsWith(t));

export function resolveModelKey(model: string): string {
  // Claude ids collapse to their tier (the dashboard groups by opus|sonnet|haiku).
  if (MODEL_ALIASES[model]) return MODEL_ALIASES[model];
  if (isAnthropic(model)) {
    for (const t of TIERS) if (model.includes(t)) return t;
  }
  // Priced non-Claude models (e.g. OpenAI) keep their own id.
  if (LITELLM_TABLE[model]) return model;

  // Never guess a price: an unrecognised model stays unknown.
  return 'unknown';
}

/** Pricing for a model, or null when ctk cannot price it. */
export function getPricing(model: string): ModelPricing | null {
  if (LITELLM_TABLE[model]) return LITELLM_TABLE[model];
  return PRICING_TABLE[resolveModelKey(model)] ?? null;
}

export interface ModelInfo {
  key: string;
  family: 'anthropic' | 'openai' | 'unknown';
  known: boolean;
  pricing: ModelPricing | null;
  contextWindow: number | null;
}

export function getModelInfo(model: string): ModelInfo {
  const key = resolveModelKey(model);
  const pricing = getPricing(model);
  const family = isAnthropic(model) ? 'anthropic' : OPENAI_MODEL.test(model) ? 'openai' : 'unknown';
  let contextWindow: number | null = CONTEXT_TABLE[model] ?? null;
  if (contextWindow === null && family === 'anthropic') {
    contextWindow = model.includes('[1m]') ? ANTHROPIC_1M_CONTEXT : ANTHROPIC_DEFAULT_CONTEXT;
  }
  return { key, family, known: pricing !== null, pricing, contextWindow };
}

export function computeCost(model: string, tokens: TokenUsage): number {
  const p = getPricing(model);
  if (!p) return 0;
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
