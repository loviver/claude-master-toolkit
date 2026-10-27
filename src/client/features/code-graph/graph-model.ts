import type {
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
): N[] {
  if (!selectedId) return [...nodes].sort(byRank).slice(0, max);
  const near = neighbourhood(selectedId, adjacency);
  const selected = nodes.find((n) => n.id === selectedId);
  const rest = nodes.filter((n) => n.id !== selectedId && near.has(n.id)).sort(byRank);
  return (selected ? [selected, ...rest] : rest).slice(0, max);
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

/** d3-style force pulling every node toward the centre of its zone, so zones read as islands. */
export function clusterForce(strength: number): ClusterForce {
  let nodes: RenderNode[] = [];
  const force = ((alpha: number) => {
    const centres = new Map<string, { x: number; y: number; z: number; count: number }>();
    for (const n of nodes) {
      const c = centres.get(n.group) ?? centres.set(n.group, { x: 0, y: 0, z: 0, count: 0 }).get(n.group)!;
      c.x += n.x ?? 0; c.y += n.y ?? 0; c.z += n.z ?? 0; c.count++;
    }
    const k = alpha * strength;
    for (const n of nodes) {
      const c = centres.get(n.group)!;
      n.vx = (n.vx ?? 0) + (c.x / c.count - (n.x ?? 0)) * k;
      n.vy = (n.vy ?? 0) + (c.y / c.count - (n.y ?? 0)) * k;
      n.vz = (n.vz ?? 0) + (c.z / c.count - (n.z ?? 0)) * k;
    }
  }) as ClusterForce;
  force.initialize = (ns) => { nodes = ns; };
  return force;
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
export function nodeVal(node: CodeGraphNodeDTO): number {
  return 1 + 24 * node.rank;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Node labels are rendered as HTML by the engine; names from the repo are not trusted markup. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
