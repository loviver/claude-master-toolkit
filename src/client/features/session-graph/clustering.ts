import type { SessionGraphNode } from '../../lib/types';

export interface TurnItem {
  kind: 'turn';
  node: SessionGraphNode;
}

export interface ClusterItem {
  kind: 'cluster';
  id: string;                          // synthetic "cluster-<firstId>-<lastId>"
  turns: SessionGraphNode[];
  signature: { phase: string; toolsKey: string; modelKey: string };
  stats: {
    totalTokens: number;
    totalCost: number;
    avgCacheHitPct: number;
    firstTurnIdx: number;
    lastTurnIdx: number;
  };
}

export type GraphItem = TurnItem | ClusterItem;

const MIN_CLUSTER = 3;

function sigOf(n: SessionGraphNode): string {
  const tools = [...n.tools].sort().join('|');
  return `${n.modelKey}::${n.phase ?? 'unknown'}::${tools}`;
}

export function clusterTurns(
  nodes: SessionGraphNode[],
  expanded: Set<string>,
  enabled: boolean,
): GraphItem[] {
  if (!enabled || nodes.length === 0) {
    return nodes.map((n) => ({ kind: 'turn', node: n }));
  }

  const items: GraphItem[] = [];
  let i = 0;
  while (i < nodes.length) {
    const n = nodes[i];
    // Sidechain turns never cluster — preserve branch visibility
    if (n.isSidechain) {
      items.push({ kind: 'turn', node: n });
      i++;
      continue;
    }

    const sig = sigOf(n);
    let j = i + 1;
    while (
      j < nodes.length &&
      !nodes[j].isSidechain &&
      sigOf(nodes[j]) === sig
    ) {
      j++;
    }

    const run = nodes.slice(i, j);
    if (run.length >= MIN_CLUSTER) {
      const id = `cluster-${run[0].id}-${run[run.length - 1].id}`;
      if (expanded.has(id)) {
        run.forEach((r) => items.push({ kind: 'turn', node: r }));
      } else {
        const totalTokens = run.reduce((s, r) => s + r.tokens, 0);
        const totalCost = run.reduce((s, r) => s + r.costUsd, 0);
        const avgCacheHitPct = Math.round(
          run.reduce((s, r) => s + r.cacheHitPct, 0) / run.length,
        );
        items.push({
          kind: 'cluster',
          id,
          turns: run,
          signature: { phase: run[0].phase ?? 'unknown', toolsKey: [...run[0].tools].sort().join('|'), modelKey: run[0].modelKey },
          stats: {
            totalTokens,
            totalCost,
            avgCacheHitPct,
            firstTurnIdx: run[0].turnIdx,
            lastTurnIdx: run[run.length - 1].turnIdx,
          },
        });
      }
    } else {
      run.forEach((r) => items.push({ kind: 'turn', node: r }));
    }
    i = j;
  }

  return items;
}
