import type { SessionGraphNode } from '../../lib/types';

export const MIN_NODE_W = 180;
export const MAX_NODE_W = 260;

function rawSignal(n: SessionGraphNode): number {
  const tokens = (n.inputTokens ?? 0) + (n.outputTokens ?? 0);
  const toolsFactor = (n.tools?.length ?? 0) * 500;
  const costFactor = (n.costUsd ?? 0) * 10_000;
  return tokens + toolsFactor + costFactor;
}

export function computeNodeWeights(nodes: SessionGraphNode[]): Map<string, number> {
  const out = new Map<string, number>();
  if (nodes.length === 0) return out;
  if (nodes.length === 1) {
    out.set(nodes[0].id, 0.5);
    return out;
  }
  const signals = nodes.map((n) => ({ id: n.id, sig: rawSignal(n) }));
  const min = Math.min(...signals.map((s) => s.sig));
  const max = Math.max(...signals.map((s) => s.sig));
  const span = max - min;
  for (const { id, sig } of signals) {
    out.set(id, span === 0 ? 0.5 : (sig - min) / span);
  }
  return out;
}

export function weightToWidth(w: number): number {
  const clamped = Math.max(0, Math.min(1, w));
  return MIN_NODE_W + clamped * (MAX_NODE_W - MIN_NODE_W);
}
