import { useMemo } from 'react';
import type { SessionDetail } from '../lib/types';

export interface SessionStatsDerived {
  durationMs: number;
  turnsPerHour: number;
  cacheHitPct: number;
  costPerTurn: number;
  /** Everything the model read: uncached input + cache reads + cache writes. */
  contextTokens: number;
}

export function computeSessionStats(session: SessionDetail): SessionStatsDerived {
  const durationMs = session.lastActiveAt - session.startedAt;
  const minutes = durationMs / 60_000;
  const turnsPerHour = minutes > 0 ? Math.round((session.turnCount / minutes) * 60 * 10) / 10 : 0;
  const { inputTokens, cacheReadTokens, cacheCreationTokens } = session.tokens;
  const contextTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
  const cacheHitPct = contextTokens > 0 ? (cacheReadTokens / contextTokens) * 100 : 0;
  const costPerTurn = session.costUsd / Math.max(session.turnCount, 1);
  return { durationMs, turnsPerHour, cacheHitPct, costPerTurn, contextTokens };
}

export function useSessionStats(session: SessionDetail): SessionStatsDerived {
  return useMemo(() => computeSessionStats(session), [session]);
}
