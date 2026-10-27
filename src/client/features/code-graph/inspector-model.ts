/**
 * Pure model of the details panel: what each neighbour row says about its edge and the diff,
 * when a long list groups by file, and the peek: a read-only look at a neighbour's code that
 * can follow names (its own stack, never the editor's history) without moving anything.
 */
import type { CodeGraphLinkType } from '../../lib/types';
import { linkEnds, type RenderLink, type RenderNode } from './graph-model';

/** Every link between one ordered pair, folded: the kinds of dependency and how many. */
export interface EdgeInfo {
  types: CodeGraphLinkType[];
  weight: number;
}

/** Edges keyed `source>target`, as the overlay's `pathLinks`. */
export function edgeIndex(links: readonly RenderLink[]): Map<string, EdgeInfo> {
  const idx = new Map<string, EdgeInfo>();
  for (const link of links) {
    const [s, t] = linkEnds(link);
    const key = `${s}>${t}`;
    const e = idx.get(key) ?? idx.set(key, { types: [], weight: 0 }).get(key)!;
    if (!e.types.includes(link.type)) e.types.push(link.type);
    e.weight += link.weight;
  }
  return idx;
}

export interface NeighbourRow extends EdgeInfo {
  node: RenderNode;
  /** Changed on this branch. */
  touched: boolean;
  /** Calls changed code. */
  blast: boolean;
}

/**
 * The rows of "Used by" (`callers`) or "Depends on" (`deps`) of `selfId`: neighbours touched
 * by the diff first, then by rank. Ids not in view are dropped.
 */
export function neighbourRows(
  ids: ReadonlySet<string> | undefined,
  selfId: string,
  direction: 'callers' | 'deps',
  nodesById: ReadonlyMap<string, RenderNode>,
  edges: ReadonlyMap<string, EdgeInfo>,
  overlay: { touched: ReadonlySet<string>; blast: ReadonlySet<string> },
): NeighbourRow[] {
  const rows: NeighbourRow[] = [];
  for (const id of ids ?? []) {
    const node = nodesById.get(id);
    if (!node) continue;
    const edge = edges.get(direction === 'callers' ? `${id}>${selfId}` : `${selfId}>${id}`);
    rows.push({ node, types: edge?.types ?? [], weight: edge?.weight ?? 0, touched: overlay.touched.has(id), blast: overlay.blast.has(id) });
  }
  const flagged = (r: NeighbourRow) => (r.touched || r.blast ? 0 : 1);
  return rows.sort((a, b) => flagged(a) - flagged(b) || b.node.rank - a.node.rank || a.node.id.localeCompare(b.node.id));
}

/** Above this many rows a list groups by file, as IntelliJ's Find Usages does. */
export const GROUP_THRESHOLD = 8;

/** `file` null: the flat list; `''`: rows without a file (modules). */
export interface RowGroup {
  file: string | null;
  rows: NeighbourRow[];
}

export function groupRows(rows: NeighbourRow[]): RowGroup[] {
  if (rows.length <= GROUP_THRESHOLD) return [{ file: null, rows }];
  const byFile = new Map<string, NeighbourRow[]>();
  for (const r of rows) {
    const file = r.node.file ?? '';
    (byFile.get(file) ?? byFile.set(file, []).get(file)!).push(r);
  }
  if (byFile.size === 1) return [{ file: null, rows }];
  return [...byFile]
    .map(([file, rs]) => ({ file, rows: rs }))
    .sort((a, b) => (a.file === '' ? 1 : 0) - (b.file === '' ? 1 : 0) || b.rows.length - a.rows.length || a.file.localeCompare(b.file));
}

/** Where a node's rank places it among the nodes in view: "#2 of 803" reads better than "0.1%". */
export function rankPosition(id: string, nodes: readonly RenderNode[]): { position: number; total: number } | null {
  const self = nodes.find((n) => n.id === id);
  if (!self) return null;
  const above = nodes.filter((n) => n.rank > self.rank || (n.rank === self.rank && n.id < self.id)).length;
  return { position: above + 1, total: nodes.length };
}

/** One step of a peek: the code it shows. */
export interface PeekFrame {
  id: string;
  label: string;
  file: string;
  /** The symbol's span; null peeks at the top of the file. */
  range: [number, number] | null;
}

export const PEEK_MAX = 20;

/** Follow a name inside the peek; re-peeking the frame on top is a no-op. */
export function peekPush(stack: PeekFrame[], frame: PeekFrame): PeekFrame[] {
  if (stack.at(-1)?.id === frame.id) return stack;
  return [...stack, frame].slice(-PEEK_MAX);
}

/** One frame back; the first frame stays (closing is the way out). */
export function peekBack(stack: PeekFrame[]): PeekFrame[] {
  return stack.length > 1 ? stack.slice(0, -1) : stack;
}

/** Lines a peek shows (1-based, inclusive): the span with context, cut to its head when long. */
export function peekWindow(range: [number, number] | null, total: number, context = 3, max = 40): [number, number] {
  if (!range) return [1, Math.min(max, total)];
  const from = Math.max(1, range[0] - context);
  const to = Math.min(total, range[1] + context);
  return [from, Math.min(to, from + max - 1)];
}

/**
 * Where the peek opens, in viewport pixels: above the row (the panel sits at the bottom),
 * below it when there is no room, and always inside the viewport horizontally.
 */
export function peekPlacement(
  anchor: { left: number; top: number; bottom: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 4,
  margin = 8,
): { left: number; top: number } {
  const above = anchor.top - gap - size.height;
  const top = above >= margin ? above : Math.min(anchor.bottom + gap, viewport.height - size.height - margin);
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - size.width - margin));
  return { left, top };
}
