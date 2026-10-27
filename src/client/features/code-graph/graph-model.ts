import type {
  CodeGraphChangeStatus,
  CodeGraphDirection,
  CodeGraphDTO,
  CodeGraphLevel,
  CodeGraphLinkType,
  CodeGraphNodeDTO,
  CodeGraphProjectDTO,
} from '../../lib/types';

/**
 * Pure view model of the code graph: everything the 3D renderer needs that is not
 * WebGL — identity across refreshes, adjacency, search, drill-down and palette —
 * so the renderer stays a thin adapter and this stays unit-testable.
 */

/** A DTO node plus the simulation state the force engine writes onto it. */
export interface RenderNode extends CodeGraphNodeDTO {
  x?: number; y?: number; z?: number;
  vx?: number; vy?: number; vz?: number;
  fx?: number; fy?: number; fz?: number;
}

/** The engine swaps `source`/`target` ids for node objects once the layout starts. */
export interface RenderLink {
  source: string | RenderNode;
  target: string | RenderNode;
  type: CodeGraphLinkType;
  weight: number;
}

export interface RenderGraph {
  revision: string;
  nodes: RenderNode[];
  links: RenderLink[];
  /** Ids new or reindexed since the previous graph (empty on the first load). */
  changed: string[];
}

const SIM_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'fx', 'fy', 'fz'] as const;

/**
 * Fold a fresh DTO into the previous render graph, carrying over the simulation state
 * of surviving nodes so a live refresh nudges the layout instead of exploding it.
 */
export function mergeGraph(prev: RenderGraph | null, next: CodeGraphDTO): RenderGraph {
  const before = new Map(prev?.nodes.map((n) => [n.id, n]));
  const changed: string[] = [];
  const nodes = next.nodes.map((dto) => {
    const old = before.get(dto.id);
    if (prev && (!old || dto.indexedAt > old.indexedAt)) changed.push(dto.id);
    const node: RenderNode = { ...dto };
    if (old) for (const k of SIM_KEYS) if (old[k] !== undefined) node[k] = old[k];
    return node;
  });
  const links = next.links.map((l) => ({ source: l.source, target: l.target, type: l.type, weight: l.weight }));
  return { revision: next.revision, nodes, links, changed };
}

export function linkEnds(link: RenderLink): [string, string] {
  const id = (end: string | RenderNode) => (typeof end === 'string' ? end : end.id);
  return [id(link.source), id(link.target)];
}

export interface Neighbours {
  /** Nodes with an edge into this one. */
  callers: Set<string>;
  /** Nodes this one has an edge to. */
  deps: Set<string>;
}

export function buildAdjacency(links: RenderLink[]): Map<string, Neighbours> {
  const adj = new Map<string, Neighbours>();
  const entry = (id: string) =>
    adj.get(id) ?? adj.set(id, { callers: new Set(), deps: new Set() }).get(id)!;
  for (const link of links) {
    const [s, t] = linkEnds(link);
    entry(s).deps.add(t);
    entry(t).callers.add(s);
  }
  return adj;
}

/** A node with everything one hop away: what the camera frames when it flies to it. */
export function neighbourhood(id: string, adjacency: Map<string, Neighbours>): Set<string> {
  const n = adjacency.get(id);
  return new Set([id, ...(n?.callers ?? []), ...(n?.deps ?? [])]);
}

const byRank = (a: CodeGraphNodeDTO, b: CodeGraphNodeDTO) => b.rank - a.rank || a.id.localeCompare(b.id);

/**
 * Nodes that may carry an always-on name, most important first. Whether each one is
 * actually drawn is decided per frame by `placeLabels`, so zooming in reveals more.
 */
export function labelCandidates<N extends CodeGraphNodeDTO>(
  nodes: N[],
  selectedId: string | null,
  adjacency: Map<string, Neighbours>,
  max: number,
  pinned: ReadonlySet<string> = new Set(),
): N[] {
  const near = selectedId ? neighbourhood(selectedId, adjacency) : null;
  const selected = nodes.find((n) => n.id === selectedId);
  const pins = nodes.filter((n) => n.id !== selectedId && pinned.has(n.id)).sort(byRank);
  const rest = nodes
    .filter((n) => n.id !== selectedId && !pinned.has(n.id) && (!near || near.has(n.id)))
    .sort(byRank);
  return [...(selected ? [selected] : []), ...pins, ...rest].slice(0, max);
}

export interface ZoneCentroid {
  group: string;
  count: number;
  x: number; y: number; z: number;
}

/** Where each zone (group) sits in the layout, biggest zone first; unplaced nodes don't count. */
export function zoneCentroids(nodes: RenderNode[]): ZoneCentroid[] {
  const zones = new Map<string, ZoneCentroid>();
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined || n.z === undefined) continue;
    const z = zones.get(n.group) ?? zones.set(n.group, { group: n.group, count: 0, x: 0, y: 0, z: 0 }).get(n.group)!;
    z.count++; z.x += n.x; z.y += n.y; z.z += n.z;
  }
  for (const z of zones.values()) { z.x /= z.count; z.y /= z.count; z.z /= z.count; }
  return [...zones.values()].sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));
}

export interface LabelBox {
  id: string;
  /** Screen-space top-left corner and size, in px. */
  x: number; y: number; w: number; h: number;
}

/** Greedy declutter: walk boxes in priority order and keep each one that overlaps none kept so far. */
export function placeLabels(boxes: LabelBox[]): Set<string> {
  const kept: LabelBox[] = [];
  for (const b of boxes) {
    const hit = kept.some((k) => b.x < k.x + k.w && k.x < b.x + b.w && b.y < k.y + k.h && k.y < b.y + b.h);
    if (!hit) kept.push(b);
  }
  return new Set(kept.map((b) => b.id));
}

export interface ClusterForce {
  (alpha: number): void;
  initialize(nodes: RenderNode[]): void;
}

/** Cluster a node by the first `depth` folders of its file; the server group is only two deep. */
export function clusterKey(node: CodeGraphNodeDTO, depth: number): string {
  if (!node.file) return node.group;
  const dirs = node.file.split('/').slice(0, -1);
  return dirs.length ? dirs.slice(0, depth).join('/') : '.';
}

/** d3-style force pulling every node toward the centre of its cluster, so clusters read as islands. */
export function clusterForce(strength: number, key: (n: RenderNode) => string = (n) => n.group): ClusterForce {
  let nodes: RenderNode[] = [];
  let keys: string[] = [];
  const force = ((alpha: number) => {
    const centres = new Map<string, { x: number; y: number; z: number; count: number }>();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const c = centres.get(keys[i]) ?? centres.set(keys[i], { x: 0, y: 0, z: 0, count: 0 }).get(keys[i])!;
      c.x += n.x ?? 0; c.y += n.y ?? 0; c.z += n.z ?? 0; c.count++;
    }
    const k = alpha * strength;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const c = centres.get(keys[i])!;
      n.vx = (n.vx ?? 0) + (c.x / c.count - (n.x ?? 0)) * k;
      n.vy = (n.vy ?? 0) + (c.y / c.count - (n.y ?? 0)) * k;
      n.vz = (n.vz ?? 0) + (c.z / c.count - (n.z ?? 0)) * k;
    }
  }) as ClusterForce;
  force.initialize = (ns) => { nodes = ns; keys = ns.map(key); };
  return force;
}

/** Radius of the sphere 3d-force-graph draws for a node value (`cbrt(val) * nodeRelSize`). */
export function nodeRadius3D(val: number, relSize: number): number {
  return Math.cbrt(val) * relSize;
}

/** Share of an overlap resolved per tick; below 1 so crowds relax instead of jittering. */
const COLLIDE_STRENGTH = 0.7;

/**
 * d3-style force keeping spheres from overlapping: every pair closer than their radii plus
 * `padding` is pushed apart along the line between them. Sweep-and-prune on x, so a sparse
 * layout costs close to n log n. Radii are read once per `initialize`.
 */
export function collideForce(radiusOf: (n: RenderNode) => number, padding: number): ClusterForce {
  let nodes: RenderNode[] = [];
  let radii: number[] = [];
  let maxRadius = 0;
  const force = ((_alpha: number) => {
    const order = nodes.map((_, i) => i).sort((a, b) => (nodes[a].x ?? 0) - (nodes[b].x ?? 0));
    for (let oi = 0; oi < order.length; oi++) {
      const i = order[oi];
      const a = nodes[i];
      for (let oj = oi + 1; oj < order.length; oj++) {
        const j = order[oj];
        const b = nodes[j];
        const dx = (b.x ?? 0) - (a.x ?? 0);
        // Sorted on x: past the widest possible reach, no later node can touch this one.
        if (dx > radii[i] + maxRadius + padding) break;
        const reach = radii[i] + radii[j] + padding;
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const dz = (b.z ?? 0) - (a.z ?? 0);
        const d = Math.hypot(dx, dy, dz);
        if (d >= reach) continue;
        // Coincident nodes have no direction to push along: split them on x.
        const [ux, uy, uz] = d > 0 ? [dx / d, dy / d, dz / d] : [1, 0, 0];
        const push = (reach - d) * 0.5 * COLLIDE_STRENGTH;
        a.vx = (a.vx ?? 0) - ux * push; a.vy = (a.vy ?? 0) - uy * push; a.vz = (a.vz ?? 0) - uz * push;
        b.vx = (b.vx ?? 0) + ux * push; b.vy = (b.vy ?? 0) + uy * push; b.vz = (b.vz ?? 0) + uz * push;
      }
    }
  }) as ClusterForce;
  force.initialize = (ns) => { nodes = ns; radii = ns.map(radiusOf); maxRadius = radii.reduce((m, r) => Math.max(m, r), 0); };
  return force;
}

/** Screen y of a label's top edge so it sits above its node's projected disc, never across it. */
export function labelTop(anchorY: number, screenRadius: number, height: number, gap: number): number {
  return anchorY - screenRadius - gap - height;
}

/**
 * Top-left corner of a tooltip beside a node: right of its projected disc, flipped to the
 * left when it would leave the canvas, clamped vertically. It never covers the node.
 */
export function tooltipBox(
  anchor: { x: number; y: number },
  screenRadius: number,
  w: number,
  h: number,
  viewport: { width: number; height: number },
  gap: number,
): { x: number; y: number } {
  const right = anchor.x + screenRadius + gap;
  const x = right + w > viewport.width ? anchor.x - screenRadius - gap - w : right;
  const y = Math.min(Math.max(0, anchor.y - h / 2), Math.max(0, viewport.height - h));
  return { x, y };
}

export function searchNodes<N extends CodeGraphNodeDTO>(nodes: N[], query: string, max = 8): N[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<[N, number]> = [];
  for (const n of nodes) {
    const label = n.label.toLowerCase();
    if (label.startsWith(q)) scored.push([n, 0]);
    else if (label.includes(q) || n.id.toLowerCase().includes(q)) scored.push([n, 1]);
  }
  return scored
    .sort(([a, ta], [b, tb]) => ta - tb || b.rank - a.rank || a.id.localeCompare(b.id))
    .slice(0, max)
    .map(([n]) => n);
}

/** Where clicking "open" on a node leads: one level finer, scoped to that node. */
export function drillTarget(
  node: CodeGraphNodeDTO,
  level: CodeGraphLevel,
): { level: CodeGraphLevel; scope: string | undefined } | null {
  switch (level) {
    case 'module': return { level: 'file', scope: node.id === '.' ? undefined : node.id };
    case 'file':   return { level: 'symbol', scope: node.file ?? node.id };
    case 'symbol': return null;
  }
}

export const DIRECTIONS: Array<{ value: CodeGraphDirection; label: string }> = [
  { value: 'callers', label: 'Used by (what breaks)' },
  { value: 'deps', label: 'Depends on' },
  { value: 'both', label: 'Both ways' },
];

/** An impact view walks callers unless told otherwise: "what would changing this break". */
export function parseDirection(raw: string | null): CodeGraphDirection {
  return DIRECTIONS.find((d) => d.value === raw)?.value ?? 'callers';
}

/** Above these sizes the finer level stops being a readable overview. */
const SYMBOL_LEVEL_MAX = 2000;
const FILE_LEVEL_MAX = 2000;

export function defaultLevel(project: CodeGraphProjectDTO): CodeGraphLevel {
  if (project.symbols <= SYMBOL_LEVEL_MAX) return 'symbol';
  if (project.files <= FILE_LEVEL_MAX) return 'file';
  return 'module';
}

// ── Palette ──
// The canvas is a fixed dark viewport in both themes (a "screen", like a code editor),
// so node colors are the light (-300) tints of the design tokens, tuned for a dark ground.

export type KindCategory = 'module' | 'file' | 'callable' | 'class' | 'type' | 'value';

export function kindCategory(kind: string): KindCategory {
  switch (kind) {
    case 'module':    return 'module';
    case 'file':      return 'file';
    case 'function':
    case 'method':    return 'callable';
    case 'class':     return 'class';
    case 'type':
    case 'interface':
    case 'enum':      return 'type';
    default:          return 'value';
  }
}

export const CANVAS_BG = '#1f1f1f';            // --vscode-editor-background (WebGL needs a literal)

export const KIND_COLORS: Record<KindCategory, string> = {
  module:   '#da7756',                          // --claude-500
  file:     '#a7a6fa',                          // --blue-300
  callable: '#6dc4d3',                          // --cyan-300
  class:    '#c69be8',                          // --purple-300
  type:     '#f3c5b3',                          // --claude-200
  value:    '#cbc5b8',                          // --gray-300
};

export const KIND_LABELS: Record<KindCategory, string> = {
  module: 'Module', file: 'File', callable: 'Function / method', class: 'Class', type: 'Type', value: 'Value',
};

export const STATE_COLORS = {
  selected: '#fafaf7',                          // --gray-50
  touched:  '#e99393',                          // --red-300   (changed on this branch)
  blast:    '#eec18a',                          // --amber-300 (calls changed code)
  hot:      '#6dd3a5',                          // --green-300 (just reindexed)
  viewing:  '#4daafc',                          // --vscode-focusBorder (the file open in the editor)
  added:    '#6dd3a5',                          // --green-300 (review: new on this branch)
  modified: '#eec18a',                          // --amber-300 (review: edited on this branch)
  dim:      '#2b2b2b',                          // --vscode-panel-border
} as const;

export const LINK_COLORS: Record<CodeGraphLinkType, string> = {
  call:     '#a7a6fa',                          // --blue-300
  dispatch: '#6dc4d3',                          // --cyan-300
  inherit:  '#c69be8',                          // --purple-300
  ref:      '#78736a',                          // --gray-500
};

export const LINK_LABELS: Record<CodeGraphLinkType, string> = {
  call: 'Calls', dispatch: 'May run (via interface)', inherit: 'Extends / implements', ref: 'References',
};

/** Runtime flow first: what may execute beats what is called directly, beats structure. */
const LINK_PRIORITY: Record<CodeGraphLinkType, number> = { dispatch: 3, call: 2, inherit: 1, ref: 0 };

/** The type a folded edge shows when several link types join the same pair. */
export function strongerLink(a: CodeGraphLinkType, b: CodeGraphLinkType): CodeGraphLinkType {
  return LINK_PRIORITY[b] > LINK_PRIORITY[a] ? b : a;
}

/**
 * Zone (folder) colors for the coarse levels, where every node is the same kind and the
 * folder is what tells them apart. Skips the state hues (red, amber, green) so the change
 * overlay still reads on top.
 */
export const ZONE_COLORS = [
  '#a7a6fa',                                    // --blue-300
  '#6dc4d3',                                    // --cyan-300
  '#c69be8',                                    // --purple-300
  '#da7756',                                    // --claude-500
  '#f3c5b3',                                    // --claude-200
  '#6b6af5',                                    // --blue-500
  '#e3ddd2',                                    // --gray-200
] as const;
export const ZONE_OTHER = '#78736a';            // --gray-500: the long tail of small zones

/** One color per zone, biggest zones first; zones past the palette share `ZONE_OTHER`. */
export function zonePalette(nodes: CodeGraphNodeDTO[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
  const ranked = [...counts].sort(([a, ca], [b, cb]) => cb - ca || a.localeCompare(b));
  return new Map(ranked.map(([group], i) => [group, ZONE_COLORS[i] ?? ZONE_OTHER]));
}

/** Relative node volume: rank dominates so hubs read as hubs at any level. */
export function nodeVal(node: CodeGraphNodeDTO, t = node.rank): number {
  return 1 + 24 * t;
}

// ── Metric encoding ──

/** What node size can encode. `rank` is centrality; the rest come off the index and git. */
export type SizeMetric = 'rank' | 'churn' | 'callers' | 'loc';
/** `ai`: how much the loaded session read and changed a node's code. */
export type ColorMode = 'kind' | SizeMetric | 'ai';

export const SIZE_METRICS: readonly SizeMetric[] = ['rank', 'churn', 'callers', 'loc'];
export const COLOR_MODES: readonly ColorMode[] = ['kind', ...SIZE_METRICS];

/** The color cycle; AI activity only means something with a session loaded. */
export function colorModes(withSession: boolean): readonly ColorMode[] {
  return withSession ? [...COLOR_MODES, 'ai'] : COLOR_MODES;
}

export const METRIC_LABELS: Record<ColorMode, string> = {
  kind: 'Kind', rank: 'Centrality', churn: 'Churn (90d commits)', callers: 'Callers', loc: 'Lines', ai: 'AI activity',
};

export function parseSizeMetric(raw: string | null): SizeMetric {
  return SIZE_METRICS.includes(raw as SizeMetric) ? (raw as SizeMetric) : 'rank';
}

export function parseColorMode(raw: string | null): ColorMode {
  return colorModes(true).includes(raw as ColorMode) ? (raw as ColorMode) : 'kind';
}

/** 0..1 against the biggest node; sqrt so one giant does not flatten everything else. */
export function metricScale(nodes: CodeGraphNodeDTO[], metric: SizeMetric): (n: CodeGraphNodeDTO) => number {
  if (metric === 'rank') return (n) => n.rank;
  const top = Math.sqrt(Math.max(0, ...nodes.map((n) => n[metric])));
  return top > 0 ? (n) => Math.sqrt(n[metric]) / top : () => 0;
}

/** A node's share of the session heat: its own file, or the files directly in a module. */
function nodeHeat(heat: ReadonlyMap<string, number>, byModule: ReadonlyMap<string, number>, n: CodeGraphNodeDTO): number {
  return n.file !== null ? heat.get(n.file) ?? 0 : byModule.get(n.id) ?? 0;
}

function aiScale(nodes: CodeGraphNodeDTO[], heat: ReadonlyMap<string, number>): (n: CodeGraphNodeDTO) => number {
  const byModule = new Map<string, number>();
  for (const [file, h] of heat) {
    const cut = file.lastIndexOf('/');
    const dir = cut < 0 ? '.' : file.slice(0, cut);
    byModule.set(dir, (byModule.get(dir) ?? 0) + h);
  }
  const top = Math.sqrt(Math.max(0, ...nodes.map((n) => nodeHeat(heat, byModule, n))));
  return top > 0 ? (n) => Math.sqrt(nodeHeat(heat, byModule, n)) / top : () => 0;
}

export function colorScale(
  nodes: CodeGraphNodeDTO[],
  mode: ColorMode,
  heat: ReadonlyMap<string, number> = new Map(),
): ((n: CodeGraphNodeDTO) => number) | null {
  if (mode === 'kind') return null;
  return mode === 'ai' ? aiScale(nodes, heat) : metricScale(nodes, mode);
}

/**
 * Cold → hot ramp for metric coloring. Stays off red/amber/green so the change overlay
 * still reads on top.
 */
export const HEAT_COLORS = [
  '#4a4842',                                    // --gray-700
  '#6b6af5',                                    // --blue-500
  '#a7a6fa',                                    // --blue-300
  '#c69be8',                                    // --purple-300
  '#da7756',                                    // --claude-500
] as const;

export function heatColor(t: number): string {
  const i = Math.min(HEAT_COLORS.length - 1, Math.floor(t * HEAT_COLORS.length));
  return HEAT_COLORS[Math.max(0, i)];
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Node labels are rendered as HTML by the engine; names from the repo are not trusted markup. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export interface ForceTuning {
  charge: number;
  linkDistance: Record<CodeGraphLinkType, number>;
  warmupTicks: number;
  cooldownTicks: number;
}

/** Physics scaled to graph size: small graphs spread out, big ones stay compact and settle fast. */
export function forceTuning(nodeCount: number): ForceTuning {
  return {
    charge: -Math.round(20 + 100 / Math.sqrt(1 + nodeCount / 100)),
    // Inheritance binds tightest, plain references loosest.
    linkDistance: { inherit: 18, call: 30, dispatch: 38, ref: 55 },
    warmupTicks: nodeCount > 1500 ? 0 : 40,
    cooldownTicks: Math.min(400, 120 + Math.round(nodeCount / 10)),
  };
}

/** Width of an always-on 3D link; log so a hot edge does not drown its neighbours. */
export function linkWidth3D(weight: number): number {
  return 0.2 + Math.log2(1 + weight) * 0.25;
}

/** Fix a dragged node where it was dropped. */
export function pinNode(node: RenderNode): void {
  node.fx = node.x; node.fy = node.y; node.fz = node.z;
}

export function unpinNode(node: RenderNode): void {
  node.fx = undefined; node.fy = undefined; node.fz = undefined;
}

// ── Filters, paths, keyboard stepping ──

/** A hidden key is a node kind category or a link type; both live in one URL param. */
export type HiddenKey = KindCategory | CodeGraphLinkType;

const KIND_KEYS: readonly KindCategory[] = ['module', 'file', 'callable', 'class', 'type', 'value'];
const LINK_KEYS: readonly CodeGraphLinkType[] = ['call', 'dispatch', 'inherit', 'ref'];

export function parseHidden(raw: string | null): Set<HiddenKey> {
  const known = new Set<string>([...KIND_KEYS, ...LINK_KEYS]);
  return new Set((raw ?? '').split(',').filter((k): k is HiddenKey => known.has(k)));
}

export function serializeHidden(hidden: ReadonlySet<HiddenKey>): string | undefined {
  return hidden.size ? [...hidden].sort().join(',') : undefined;
}

export interface GraphFilter {
  hidden: ReadonlySet<HiddenKey>;
  exportedOnly: boolean;
}

/** Client-side view filter; keeps node objects so the layout does not restart. */
export function filterGraph(graph: RenderGraph, filter: GraphFilter): RenderGraph {
  if (filter.hidden.size === 0 && !filter.exportedOnly) return graph;
  const nodes = graph.nodes.filter((n) =>
    !filter.hidden.has(kindCategory(n.kind)) && (!filter.exportedOnly || n.exported));
  const keep = new Set(nodes.map((n) => n.id));
  const links = graph.links.filter((l) => {
    const [s, t] = linkEnds(l);
    return !filter.hidden.has(l.type) && keep.has(s) && keep.has(t);
  });
  return { ...graph, nodes, links };
}

function bfs(from: string, to: string, next: (id: string) => Iterable<string>): string[] | null {
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === to) {
      const path: string[] = [];
      for (let at: string | null = to; at !== null; at = prev.get(at)!) path.push(at);
      return path.reverse();
    }
    for (const n of next(id)) if (!prev.has(n)) { prev.set(n, id); queue.push(n); }
  }
  return null;
}

/**
 * Shortest chain from `from` to `to`: along deps first (how A reaches B at runtime), then
 * ignoring direction (how the two are related at all).
 */
export function shortestPath(adj: Map<string, Neighbours>, from: string, to: string): string[] | null {
  return bfs(from, to, (id) => adj.get(id)?.deps ?? [])
    ?? bfs(from, to, (id) => [...(adj.get(id)?.deps ?? []), ...(adj.get(id)?.callers ?? [])]);
}

/** The i-th neighbour in one direction, highest rank first, wrapping: arrow keys walk the graph. */
export function neighbourAt(
  adj: Map<string, Neighbours>,
  rank: ReadonlyMap<string, number>,
  id: string,
  direction: 'callers' | 'deps',
  i: number,
): string | null {
  const list = [...(adj.get(id)?.[direction] ?? [])]
    .sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0) || a.localeCompare(b));
  return list.length ? list[i % list.length] : null;
}

/** `s>t` keys for every hop of a path, both ways: a path drawn over a link of either direction. */
export function pathLinkKeys(path: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    keys.add(`${path[i - 1]}>${path[i]}`);
    keys.add(`${path[i]}>${path[i - 1]}`);
  }
  return keys;
}

/** How far upstream review mode follows the diff's impact. */
export const IMPACT_HOPS = 4;

/**
 * Review impact ramp, one step per hop: near callers bright, far ones fading into the dim gray.
 * Cyan, so it never reads as the blue→purple metric ramp (which review turns off anyway).
 */
export const IMPACT_COLORS = [
  '#6dc4d3',                                    // --cyan-300
  '#4f98a3',
  '#3b6d74',
  '#3a4446',
] as const;

/**
 * Hops from the nearest changed node, walking callers (who would feel the change).
 * Changed nodes themselves are left out; the walk stops at `maxHops`.
 */
export function impactDistance(
  adjacency: Map<string, Neighbours>,
  changed: Iterable<string>,
  maxHops = IMPACT_HOPS,
): Map<string, number> {
  const seen = new Set(changed);
  const out = new Map<string, number>();
  let frontier = [...seen];
  for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const caller of adjacency.get(id)?.callers ?? []) {
        if (seen.has(caller)) continue;
        seen.add(caller);
        out.set(caller, hop);
        next.push(caller);
      }
    }
    frontier = next;
  }
  return out;
}

export function impactColor(hops: number): string {
  return IMPACT_COLORS[Math.min(IMPACT_COLORS.length, Math.max(1, hops)) - 1];
}

/** Review mode's git-style paint: changed by status, impacted by distance, the rest gray. */
export function reviewColor(
  id: string,
  status: ReadonlyMap<string, CodeGraphChangeStatus>,
  impact: ReadonlyMap<string, number>,
): string {
  const s = status.get(id);
  if (s) return STATE_COLORS[s];
  const hops = impact.get(id);
  return hops === undefined ? STATE_COLORS.dim : impactColor(hops);
}

/**
 * Review mode: the branch's changed nodes plus their blast radius, and the links among them.
 * Same shape as a traced path (`s>t` keys), so the renderers dim everything else for free.
 */
export function reviewSpotlight(
  links: RenderLink[],
  touched: Iterable<string>,
  blast: Iterable<string>,
): { nodes: Set<string>; links: Set<string> } {
  const nodes = new Set([...touched, ...blast]);
  const keys = new Set<string>();
  for (const link of links) {
    const [s, t] = linkEnds(link);
    if (nodes.has(s) && nodes.has(t)) keys.add(`${s}>${t}`);
  }
  return { nodes, links: keys };
}
