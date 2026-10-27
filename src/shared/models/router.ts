import { getAdapter } from '../agents/index.js';
import type { AgentId } from '../agents/interface.js';

export type ModelTier = 'high' | 'mid' | 'low';

const TIER_NAMES: readonly string[] = ['high', 'mid', 'low'];
const LEGACY_TO_TIER: Record<string, ModelTier> = { opus: 'high', sonnet: 'mid', haiku: 'low' };
const HIGH_PHASES = new Set(['sdd-propose', 'sdd-design', 'orchestrator']);
const LOW_PHASES = new Set(['sdd-archive']);

export interface RouteInput {
  agent: AgentId;
  /** Main-thread model of the agent (returned whenever we must inherit). */
  current: string;
  /** Contents of the model-preference file. */
  pref: string;
  /** SDD phase, or a tier name (high|mid|low). */
  phase: string;
}

/**
 * Single source of truth for sub-agent model selection (CLI + MCP).
 * A tier the agent cannot map (tierModel -> null) degrades to inherit.
 */
export function resolveModel({ agent, current, pref, phase }: RouteInput): string {
  if (pref.startsWith('pinned:')) return pref.slice(7);

  const adapter = getAdapter(agent);
  const viaTier = (tier: ModelTier): string => adapter.tierModel(tier) ?? current;

  if (pref === 'auto' || pref === 'smart') {
    if (TIER_NAMES.includes(phase)) return viaTier(phase as ModelTier);
    if (HIGH_PHASES.has(phase)) return viaTier('high');
    if (LOW_PHASES.has(phase)) return viaTier('low');
    return current;
  }

  const legacy = LEGACY_TO_TIER[pref];
  if (legacy) return viaTier(legacy);

  return current;
}
