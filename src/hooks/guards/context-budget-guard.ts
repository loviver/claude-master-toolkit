import type { HookResult } from '../runtime/types.js';

export function contextPct(tokens: number, limit: number): number {
  return limit > 0 ? Math.floor((tokens / limit) * 100) : 0;
}

export interface ContextBudgetInput {
  tokens: number;
  limit: number;
  model: string;
  /** Levels already warned this session ('70' | '85' | '95'). */
  warned: string[];
  /** Realized cost string, when known. */
  cost?: string;
}

const LEVELS: Array<{ at: number; level: string; msg: string }> = [
  { at: 95, level: '95', msg: 'CRITICAL — run /compact NOW or risk truncation' },
  { at: 85, level: '85', msg: 'HIGH — /compact recommended before next large operation' },
  { at: 70, level: '70', msg: 'threshold crossed — plan a /compact soon' },
];

/** Warns once per threshold crossing. `level` tells the caller which level to persist. */
export function contextBudgetGuard(input: ContextBudgetInput): { result: HookResult; level?: string } {
  const pct = contextPct(input.tokens, input.limit);
  const hit = LEVELS.find((l) => pct >= l.at);
  if (!hit || input.warned.includes(hit.level)) return { result: { kind: 'noop' } };

  let text = `\n⚠  Context Guardian: ${hit.msg}\n`;
  text += `   Usage: ${pct}% (approx ${input.tokens} tokens of ${input.limit})\n`;
  if (input.cost) text += `   Realized cost: $${input.cost} (${input.model})\n`;
  return { result: { kind: 'context', text }, level: hit.level };
}
