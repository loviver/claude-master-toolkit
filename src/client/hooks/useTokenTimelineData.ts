import { useMemo } from 'react';
import type { TokenEvent } from '../lib/types';

export interface TimelinePoint {
  turn: number;
  model: string;
  timestamp: number;
  input: number;
  output: number;
  cacheR: number;
  cacheW: number;
  cost: number;
}

export interface TimelineSegment {
  model: string;
  start: number;
  end: number;
}

export interface TokenTimelineData {
  data: TimelinePoint[];
  segments: TimelineSegment[];
  uniqueModels: string[];
}

export function buildTokenTimelineData(events: TokenEvent[]): TokenTimelineData {
  const data: TimelinePoint[] = events.map((e, i) => ({
    turn: i + 1,
    model: e.model,
    timestamp: e.timestamp,
    input: e.inputTokens,
    output: e.outputTokens,
    cacheR: e.cacheReadTokens,
    cacheW: e.cacheCreationTokens,
    cost: Number(e.costUsd.toFixed(6)),
  }));

  const segments: TimelineSegment[] = [];
  for (let i = 0; i < events.length; i++) {
    const m = events[i].model;
    const last = segments[segments.length - 1];
    if (!last || last.model !== m) segments.push({ model: m, start: i, end: i });
    else last.end = i;
  }

  const uniqueModels = [...new Set(events.map((e) => e.model))];
  return { data, segments, uniqueModels };
}

export function useTokenTimelineData(events: TokenEvent[]): TokenTimelineData {
  return useMemo(() => buildTokenTimelineData(events), [events]);
}
