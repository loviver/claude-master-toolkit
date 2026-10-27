import { stronglyConnected } from './matrix-model';

/**
 * Layered (Sugiyama-style) layout of a dependency graph: callers on top, what they
 * use below. Cycles collapse into one layer and their edges are flagged, because an
 * edge that cannot point downwards is exactly the layering violation worth seeing.
 */

export interface LayerEdge {
  source: string | { id: string };
  target: string | { id: string };
}

export interface Layers {
  layers: string[][];
  layerOf: Map<string, number>;
  /** `source->target` keys of edges inside a cycle (same layer). */
  cyclic: Set<string>;
}

const endId = (end: string | { id: string }) => (typeof end === 'string' ? end : end.id);
export const edgeKey = (source: string, target: string) => `${source}->${target}`;
const SWEEPS = 4;

export function layoutLayers(ids: readonly string[], edges: readonly LayerEdge[]): Layers {
  const known = new Set(ids);
  const pairs = edges
    .map((e) => [endId(e.source), endId(e.target)] as const)
    .filter(([s, t]) => s !== t && known.has(s) && known.has(t));
  const sccs = stronglyConnected(ids, pairs);
  const compOf = new Map<string, number>();
  sccs.forEach((comp, i) => comp.forEach((id) => compOf.set(id, i)));

  // Longest path over the condensation. Components are emitted callees first: walk them backwards.
  const compLayer = new Array<number>(sccs.length).fill(0);
  const outgoing = new Map<number, Set<number>>();
  for (const [s, t] of pairs) {
    const cs = compOf.get(s)!;
    const ct = compOf.get(t)!;
    if (cs === ct) continue;
    if (!outgoing.has(cs)) outgoing.set(cs, new Set());
    outgoing.get(cs)!.add(ct);
  }
  for (let c = sccs.length - 1; c >= 0; c--) {
    for (const d of outgoing.get(c) ?? []) compLayer[d] = Math.max(compLayer[d], compLayer[c] + 1);
  }

  const layerOf = new Map(ids.map((id) => [id, compLayer[compOf.get(id)!]]));
  const depth = Math.max(-1, ...layerOf.values()) + 1;
  const layers: string[][] = Array.from({ length: depth }, () => []);
  for (const id of ids) layers[layerOf.get(id)!].push(id);

  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [s, t] of pairs) { neighbours.get(s)!.push(t); neighbours.get(t)!.push(s); }
  reduceCrossings(layers, layerOf, neighbours);

  const cyclic = new Set<string>();
  for (const [s, t] of pairs) if (compOf.get(s) === compOf.get(t)) cyclic.add(edgeKey(s, t));
  return { layers, layerOf, cyclic };
}

/** Reorder each layer by the mean position of its neighbours, sweeping down then up. */
function reduceCrossings(layers: string[][], layerOf: Map<string, number>, neighbours: Map<string, string[]>) {
  const slot = new Map<string, number>();
  const refresh = () => layers.forEach((layer) => layer.forEach((id, i) => slot.set(id, layer.length > 1 ? i / (layer.length - 1) : 0.5)));
  const sweep = (l: number, towards: (n: number) => boolean) => {
    const score = (id: string) => {
      const near = neighbours.get(id)!.filter((n) => towards(layerOf.get(n)!));
      return near.length ? near.reduce((sum, n) => sum + slot.get(n)!, 0) / near.length : slot.get(id)!;
    };
    const keyed = layers[l].map((id, i) => ({ id, i, s: score(id) }));
    keyed.sort((a, b) => a.s - b.s || a.i - b.i);
    layers[l] = keyed.map((k) => k.id);
    refresh();
  };
  refresh();
  for (let n = 0; n < SWEEPS; n++) {
    for (let l = 1; l < layers.length; l++) sweep(l, (x) => x < l);
    for (let l = layers.length - 2; l >= 0; l--) sweep(l, (x) => x > l);
  }
}

/** Edge crossings between adjacent layers (what the sweeps minimise); for tests and diagnostics. */
export function countCrossings(layers: readonly (readonly string[])[], edges: readonly LayerEdge[]): number {
  const at = new Map<string, [number, number]>();
  layers.forEach((layer, l) => layer.forEach((id, i) => at.set(id, [l, i])));
  const segs: Array<[number, number, number]> = [];
  for (const e of edges) {
    const a = at.get(endId(e.source));
    const b = at.get(endId(e.target));
    if (!a || !b || Math.abs(a[0] - b[0]) !== 1) continue;
    const [top, bottom] = a[0] < b[0] ? [a, b] : [b, a];
    segs.push([top[0], top[1], bottom[1]]);
  }
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i][0] === segs[j][0] && (segs[i][1] - segs[j][1]) * (segs[i][2] - segs[j][2]) < 0) n++;
    }
  }
  return n;
}
