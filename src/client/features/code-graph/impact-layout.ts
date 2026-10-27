import type { CodeGraphDirection, CodeGraphNodeDTO } from '../../lib/types';
import { DIFF_FOCUS } from '../../../shared/api-types';
import type { ClusterForce, Neighbours, RenderNode } from './graph-model';

/**
 * Impact layout: an impact view answers "how far does this change reach", so distance in
 * hops becomes distance on screen — the focus in the centre, one ring per hop around it.
 * Pure, so both renderers share it and it stays unit-testable.
 */

/** The nodes an impact walk starts from, mirroring the server: a node id, a folder, or the diff. */
export function focusSeeds(
  nodes: CodeGraphNodeDTO[],
  focus: string,
  touched: Iterable<string>,
): Set<string> {
  const ids = new Set(nodes.map((n) => n.id));
  if (focus === DIFF_FOCUS) return new Set([...touched].filter((id) => ids.has(id)));
  if (ids.has(focus)) return new Set([focus]);
  const dir = focus.replace(/\/+$/, '');
  return new Set(nodes
    .filter((n) => {
      const path = n.file ?? n.id;
      return path === dir || path.startsWith(`${dir}/`);
    })
    .map((n) => n.id));
}

/** Hops from the nearest seed (seeds at 0), following the edges `direction` names. */
export function hopDistance(
  adjacency: Map<string, Neighbours>,
  seeds: Iterable<string>,
  direction: CodeGraphDirection,
): Map<string, number> {
  const out = new Map<string, number>();
  let frontier = [...seeds];
  for (const id of frontier) out.set(id, 0);
  for (let hop = 1; frontier.length; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      const n = adjacency.get(id);
      if (!n) continue;
      const step = direction === 'callers' ? n.callers : direction === 'deps' ? n.deps : [...n.callers, ...n.deps];
      for (const other of step) {
        if (out.has(other)) continue;
        out.set(other, hop);
        next.push(other);
      }
    }
    frontier = next;
  }
  return out;
}

export interface RadialOptions {
  /** Minimum distance between consecutive rings. */
  ringGap: number;
  /** Free space kept between two nodes of the same ring. */
  padding: number;
}

export interface Point { x: number; y: number }

const TAU = Math.PI * 2;
/** Where a ring with nothing to align to starts: the top, the way the eye reads. */
const TOP = -Math.PI / 2;

function circularMean(angles: number[]): number | null {
  if (!angles.length) return null;
  let sx = 0, sy = 0;
  for (const a of angles) { sx += Math.cos(a); sy += Math.sin(a); }
  return sx === 0 && sy === 0 ? angles[0] : Math.atan2(sy, sx);
}

/**
 * Concentric rings by hop: ring k holds the nodes k hops from the focus; nodes the walk did
 * not reach go on one ring past the last hop. Each ring is ordered by the mean angle of its
 * already-placed neighbours (barycenter), so a subtree fans out behind its parent instead of
 * crossing the disc, and grows until no two of its nodes overlap.
 */
export function radialLayout(
  ids: string[],
  hops: ReadonlyMap<string, number>,
  adjacency: Map<string, Neighbours>,
  radiusOf: (id: string) => number,
  { ringGap, padding }: RadialOptions,
): Map<string, Point> {
  let lastHop = 0;
  for (const id of ids) lastHop = Math.max(lastHop, hops.get(id) ?? 0);
  const rings = new Map<number, string[]>();
  for (const id of ids) {
    const k = hops.get(id) ?? lastHop + 1;
    (rings.get(k) ?? rings.set(k, []).get(k)!).push(id);
  }

  const pos = new Map<string, Point>();
  const angleOf = new Map<string, number>();
  let prevRadius = 0;
  let prevMaxNode = 0;
  let first = true;
  for (const k of [...rings.keys()].sort((a, b) => a - b)) {
    const members = rings.get(k)!;
    const bary = new Map<string, number | null>();
    for (const id of members) {
      const n = adjacency.get(id);
      const near = n ? [...n.callers, ...n.deps].filter((o) => angleOf.has(o)).map((o) => angleOf.get(o)!) : [];
      bary.set(id, circularMean(near));
    }
    const ring = members.sort((a, b) => {
      const ba = bary.get(a), bb = bary.get(b);
      if (ba != null && bb != null && ba !== bb) return ba - bb;
      if ((ba == null) !== (bb == null)) return ba == null ? 1 : -1;
      return a.localeCompare(b);
    });

    const r = ring.map(radiusOf);
    const maxNode = r.reduce((m, v) => Math.max(m, v), 0);
    // Slot i spans its node's diameter plus the padding; angles split the circle by slot width.
    const widths = r.map((v) => 2 * v + padding);
    const total = widths.reduce((s, w) => s + w, 0);
    const slot: number[] = [];
    let cum = 0;
    for (const w of widths) { slot.push(TAU * (cum + w / 2) / total); cum += w; }

    // Smallest radius at which every pair of neighbours on the ring clears each other.
    let radius = 0;
    if (ring.length > 1) {
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        const gap = j === 0 ? TAU - slot[i] + slot[0] : slot[j] - slot[i];
        radius = Math.max(radius, (r[i] + r[j] + padding) / (2 * Math.sin(Math.min(Math.PI, gap) / 2)));
      }
    }
    if (!first || ring.length > 1) {
      radius = Math.max(radius, first ? 0 : prevRadius + Math.max(ringGap, prevMaxNode + maxNode + padding));
    }

    // Rotate the ring so, on average, each node sits on its barycenter.
    const offsets = ring.flatMap((id, i) => (bary.get(id) == null ? [] : [bary.get(id)! - slot[i]]));
    const start = circularMean(offsets) ?? TOP;
    ring.forEach((id, i) => {
      const a = start + slot[i];
      angleOf.set(id, a);
      pos.set(id, radius === 0 ? { x: 0, y: 0 } : { x: radius * Math.cos(a), y: radius * Math.sin(a) });
    });
    prevRadius = radius;
    prevMaxNode = maxNode;
    first = false;
  }
  return pos;
}

/**
 * d3-style force easing each node toward its ring position on the plane z = 0. The 3D
 * engine's own velocity decay turns it into a glide, where pinning would teleport.
 */
export function anchorForce(targets: ReadonlyMap<string, Point>, strength: number): ClusterForce {
  let nodes: RenderNode[] = [];
  const force = ((alpha: number) => {
    const k = alpha * strength;
    for (const n of nodes) {
      const t = targets.get(n.id);
      if (!t) continue;
      n.vx = (n.vx ?? 0) + (t.x - (n.x ?? 0)) * k;
      n.vy = (n.vy ?? 0) + (t.y - (n.y ?? 0)) * k;
      n.vz = (n.vz ?? 0) - (n.z ?? 0) * k;
    }
  }) as ClusterForce;
  force.initialize = (ns) => { nodes = ns; };
  return force;
}

export interface RingGuide {
  /** Hops from the focus; null for the ring of nodes the walk did not reach. */
  hop: number | null;
  radius: number;
}

/** One guide circle per ring of a `radialLayout`, innermost first; a lone central seed has none. */
export function ringRadii(
  ids: string[],
  hops: ReadonlyMap<string, number>,
  positions: ReadonlyMap<string, Point>,
): RingGuide[] {
  const radius = new Map<number | null, number>();
  for (const id of ids) {
    const p = positions.get(id);
    if (!p) continue;
    const hop = hops.get(id) ?? null;
    radius.set(hop, Math.max(radius.get(hop) ?? 0, Math.hypot(p.x, p.y)));
  }
  return [...radius]
    .filter(([, r]) => r > 0)
    .map(([hop, r]) => ({ hop, radius: r }))
    .sort((a, b) => a.radius - b.radius);
}

export function ringLabel(hop: number | null): string {
  if (hop === null) return 'unreached';
  if (hop === 0) return 'focus';
  return `${hop} hop${hop > 1 ? 's' : ''}`;
}
