import type { Phase, SessionGraphNodeDTO } from '../../lib/types';

export interface SessionInsights {
  toolErrors: number;
  apiErrors: number;
  compactions: number;
  maxTokensStops: number;
  topTools: Array<{ name: string; count: number }>;
  agents: Array<{ role: string; turns: number; costUsd: number }>;
  phases: Array<{ phase: Phase; turns: number; pct: number }>;
  thinkingPct: number;
  filesChanged: number;
  hooks: number;
  webCalls: number;
  slowest: { turnIdx: number; durationMs: number } | null;
  p50DurationMs: number | null;
}

const TOP_TOOLS = 8;

function countBy<K>(keys: K[]): Map<K, number> {
  const out = new Map<K, number>();
  for (const k of keys) out.set(k, (out.get(k) ?? 0) + 1);
  return out;
}

/** Session-level rollup of the per-turn enrichment the graph endpoint already returns. */
export function computeSessionInsights(turns: SessionGraphNodeDTO[]): SessionInsights {
  let toolErrors = 0, apiErrors = 0, compactions = 0, maxTokensStops = 0;
  let thinking = 0, filesChanged = 0, hooks = 0, webCalls = 0;
  const agents = new Map<string, { turns: number; costUsd: number }>();

  for (const t of turns) {
    toolErrors += t.toolsErrorCount ?? 0;
    if (t.isApiError) apiErrors++;
    if (t.isCompactSummary) compactions++;
    if (t.stopReason === 'max_tokens') maxTokensStops++;
    if (t.hasThinking) thinking++;
    filesChanged += t.filesChangedCount ?? 0;
    hooks += t.hooksCount ?? 0;
    webCalls += (t.webSearchCount ?? 0) + (t.webFetchCount ?? 0);
    if (t.isSidechain) {
      const role = t.agentRole ?? 'sub-agent';
      const a = agents.get(role) ?? { turns: 0, costUsd: 0 };
      a.turns++;
      a.costUsd += t.costUsd;
      agents.set(role, a);
    }
  }

  const topTools = [...countBy(turns.flatMap((t) => t.tools))]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_TOOLS);

  const phases = [...countBy(turns.map((t) => t.phase))]
    .map(([phase, n]) => ({ phase, turns: n, pct: (n / turns.length) * 100 }))
    .sort((a, b) => b.turns - a.turns);

  const timed = turns
    .filter((t): t is SessionGraphNodeDTO & { durationMs: number } => t.durationMs != null)
    .sort((a, b) => a.durationMs - b.durationMs);
  const last = timed[timed.length - 1];

  return {
    toolErrors,
    apiErrors,
    compactions,
    maxTokensStops,
    topTools,
    agents: [...agents].map(([role, a]) => ({ role, ...a })).sort((a, b) => b.costUsd - a.costUsd),
    phases,
    thinkingPct: turns.length ? (thinking / turns.length) * 100 : 0,
    filesChanged,
    hooks,
    webCalls,
    slowest: last ? { turnIdx: last.turnIdx, durationMs: last.durationMs } : null,
    p50DurationMs: timed.length ? timed[Math.floor((timed.length - 1) / 2)].durationMs : null,
  };
}
