import type {
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

export const CANVAS_BG = '#16140f';            // --gray-900

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
  dim:      '#3a3731',                          // --gray-700
} as const;

export const LINK_COLORS: Record<CodeGraphLinkType, string> = {
  call: '#a7a6fa',                              // --blue-300
  ref:  '#78736a',                              // --gray-500
};

/** Relative node volume: rank dominates so hubs read as hubs at any level. */
export function nodeVal(node: CodeGraphNodeDTO): number {
  return 1 + 24 * node.rank;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Node labels are rendered as HTML by the engine; names from the repo are not trusted markup. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
