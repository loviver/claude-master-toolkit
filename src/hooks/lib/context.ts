import { getModelInfo } from '../../shared/pricing.js';
import { readMainModel } from '../../shared/agents/resolve.js';
import type { HookEvent } from '../runtime/types.js';

const FALLBACK_WINDOW = 200_000;

export function eventModel(e: HookEvent): string {
  return e.model ?? readMainModel(e.agent as never);
}

export function contextLimit(model: string): number {
  const override = Number(process.env['CLAUDE_CONTEXT_WINDOW']);
  if (override > 0) return override;
  return getModelInfo(model).contextWindow ?? FALLBACK_WINDOW;
}
