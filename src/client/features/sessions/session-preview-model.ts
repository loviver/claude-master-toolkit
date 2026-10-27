import type { ModelKey, Phase, SessionSummary } from '../../lib/types';

/** Per-turn token volume and phase, in turn order: the session's shape at a glance. */
export function turnSeries(nodes: ReadonlyArray<{ turnIdx: number; tokens: number; phase: Phase }>) {
  const ordered = [...nodes].sort((a, b) => a.turnIdx - b.turnIdx);
  return { tokens: ordered.map((n) => n.tokens), phases: ordered.map((n) => n.phase) };
}

export interface ModelShare {
  model: string;
  modelKey: ModelKey;
  share: number;
}

/** Each model's share of the session, by cost (by turns when nothing cost anything). */
export function modelMix(models: SessionSummary['models']): ModelShare[] {
  const costTotal = models.reduce((sum, m) => sum + m.costUsd, 0);
  const weight = costTotal > 0 ? (m: SessionSummary['models'][number]) => m.costUsd : (m: SessionSummary['models'][number]) => m.turns;
  const total = models.reduce((sum, m) => sum + weight(m), 0);
  if (total <= 0) return [];
  return models
    .map((m) => ({ model: m.model, modelKey: m.modelKey, share: weight(m) / total }))
    .sort((a, b) => b.share - a.share);
}

/** A session's cost against the most expensive one listed, for the inline bar. */
export function costShare(cost: number, maxCost: number): number {
  if (maxCost <= 0) return 0;
  return Math.min(1, Math.max(0, cost / maxCost));
}
