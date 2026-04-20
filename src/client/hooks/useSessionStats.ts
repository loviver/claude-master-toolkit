import { useMemo } from 'react';
import type { SessionDetail } from '../lib/types';

export interface SessionStatsDerived {
  durationMs: number;
  turnsPerHour: number;
  cacheHitPct: number;
  costPerTurn: number;
}

export function computeSessionStats(session: SessionDetail): SessionStatsDerived {
  const durationMs = session.lastActiveAt - session.startedAt;
  const minutes = durationMs / 60_000;
  const turnsPerHour = minutes > 0 ? Math.round((session.turnCount / minutes) * 60 * 10) / 10 : 0;
  const cacheInput = session.tokens.cacheReadTokens + session.tokens.inputTokens;
  const cacheHitPct = cacheInput > 0 ? (session.tokens.cacheReadTokens / cacheInput) * 100 : 0;
  const costPerTurn = session.costUsd / Math.max(session.turnCount, 1);
  return { durationMs, turnsPerHour, cacheHitPct, costPerTurn };
}

export function useSessionStats(session: SessionDetail): SessionStatsDerived {
  return useMemo(() => computeSessionStats(session), [session]);
}
