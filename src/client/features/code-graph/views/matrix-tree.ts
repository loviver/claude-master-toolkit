import type { CodeGraphLinkType } from '../../../lib/types';
import { strongerLink } from '../graph-model';
import { stronglyConnected, type MatrixLink } from './matrix-model';

/**
 * Hierarchical model of the dependency matrix: rows grouped by folder (and by file at the
 * symbol level), each group ordered callees-first so dependencies stay below the diagonal,
 * and folders that can fold into a single aggregated row.
 */

export interface TreeNodeInput {
  id: string;
  file: string | null;
  label?: string;
}

export type TreeItem =
  | { kind: 'folder'; folder: Folder }
  | { kind: 'leaf'; id: string; label: string };

export interface Folder {
  /** Full path; the key a collapsed group row and its span carry. */
  path: string;
  /** Segment name, or several joined by `/` once a single-child chain is compressed. */
  label: string;
  children: TreeItem[];
}

export interface Row {
  /** Node id for a leaf, folder path for a group. */
  key: string;
  kind: 'leaf' | 'group';
  depth: number;
  label: string;
  /** Node ids the row stands for: itself, or every node under the collapsed folder. */
  members: string[];
}

/** An expanded folder: the contiguous rows it holds. */
export interface GroupSpan {
  path: string;
  label: string;
  start: number;
  end: number;
  depth: number;
}

export interface AggregatedCell {
  row: number;
  col: number;
  weight: number;
  /** Links folded into the cell. */
  count: number;
  type: CodeGraphLinkType;
  /** Some folded link joins two nodes of the same cycle. */
  inCycle: boolean;
  /** A few of the folded links, for the tooltip. */
  samples: Array<[string, string]>;
}

export interface CycleSpan {
  members: string[];
  rows: number[];
  /** The rows are adjacent, so one box on the diagonal covers the cycle. */
  contiguous: boolean;
}

const endId = (end: string | { id: string }) => (typeof end === 'string' ? end : end.id);
const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const SAMPLES = 3;

/** The group a node sits in: a symbol in its file, a file in its folder, a module in its parent. */
export function containerOf(node: TreeNodeInput): string {
  if (node.file && node.id !== node.file) return node.file;
  return dirname(node.id);
}

export function buildTree(nodes: readonly TreeNodeInput[]): Folder {
  const root: Folder = { path: '', label: '', children: [] };
  const folders = new Map<string, Folder>([['', root]]);
  const folderAt = (path: string): Folder => {
    const known = folders.get(path);
    if (known) return known;
    const folder: Folder = { path, label: path.slice(path.lastIndexOf('/') + 1), children: [] };
    folders.set(path, folder);
    folderAt(dirname(path)).children.push({ kind: 'folder', folder });
    return folder;
  };
  for (const n of nodes) folderAt(containerOf(n)).children.push({ kind: 'leaf', id: n.id, label: n.label ?? n.id });

  let top = compress(root);
  while (top.children.length === 1 && top.children[0].kind === 'folder') top = top.children[0].folder;
  return top;
}

/** Fold every folder that only holds one folder into it, so a deep chain reads as one level. */
function compress(folder: Folder): Folder {
  folder.children = folder.children
    .map((item): TreeItem => {
      if (item.kind === 'leaf') return item;
      let child = compress(item.folder);
      while (child.children.length === 1 && child.children[0].kind === 'folder') {
        const only = child.children[0].folder;
        child = { ...only, label: `${child.label}/${only.label}` };
      }
      return { kind: 'folder', folder: child };
    })
    .sort((a, b) => itemLabel(a).localeCompare(itemLabel(b)));
  return folder;
}

const itemLabel = (item: TreeItem) => (item.kind === 'leaf' ? item.label : item.folder.label);

function leavesOf(folder: Folder, out: string[] = []): string[] {
  for (const item of folder.children) {
    if (item.kind === 'leaf') out.push(item.id);
    else leavesOf(item.folder, out);
  }
  return out;
}

/** Order every folder's children callees-first by the links between them, recursively. */
export function orderTree(folder: Folder, links: readonly MatrixLink[]): Folder {
  const itemOf = new Map<string, number>();
  folder.children.forEach((item, i) => {
    for (const id of item.kind === 'leaf' ? [item.id] : leavesOf(item.folder)) itemOf.set(id, i);
  });
  const edges: Array<[string, string]> = [];
  for (const l of links) {
    const s = itemOf.get(endId(l.source));
    const t = itemOf.get(endId(l.target));
    if (s !== undefined && t !== undefined && s !== t) edges.push([String(s), String(t)]);
  }
  const keys = folder.children.map((_, i) => String(i));
  const order = stronglyConnected(keys, edges).flat().map(Number);
  return {
    ...folder,
    children: order.map((i) => {
      const item = folder.children[i];
      return item.kind === 'leaf' ? item : { kind: 'folder', folder: orderTree(item.folder, links) };
    }),
  };
}

export function visibleRows(root: Folder, collapsed: ReadonlySet<string>): { rows: Row[]; spans: GroupSpan[] } {
  const rows: Row[] = [];
  const spans: GroupSpan[] = [];
  const walk = (folder: Folder, depth: number) => {
    for (const item of folder.children) {
      if (item.kind === 'leaf') {
        rows.push({ key: item.id, kind: 'leaf', depth, label: item.label, members: [item.id] });
      } else if (collapsed.has(item.folder.path)) {
        rows.push({ key: item.folder.path, kind: 'group', depth, label: item.folder.label, members: leavesOf(item.folder) });
      } else {
        const start = rows.length;
        walk(item.folder, depth + 1);
        if (rows.length > start) {
          spans.push({ path: item.folder.path, label: item.folder.label, start, end: rows.length - 1, depth });
        }
      }
    }
  };
  walk(root, 0);
  return { rows, spans };
}

export function aggregateCells(rows: readonly Row[], links: readonly MatrixLink[]): {
  cells: AggregatedCell[];
  /** Node-level cycles (components of 2+ nodes). */
  cycles: string[][];
  /** Collapsed rows that hide a cycle among their own members. */
  cyclicRows: Set<number>;
} {
  const rowOf = new Map<string, number>();
  rows.forEach((r, i) => r.members.forEach((id) => rowOf.set(id, i)));
  const pairs: Array<[string, string]> = [];
  for (const l of links) {
    const s = endId(l.source);
    const t = endId(l.target);
    if (s !== t && rowOf.has(s) && rowOf.has(t)) pairs.push([s, t]);
  }
  const sccs = stronglyConnected([...rowOf.keys()], pairs);
  const compOf = new Map<string, number>();
  sccs.forEach((comp, i) => comp.forEach((id) => compOf.set(id, i)));

  const cells = new Map<string, AggregatedCell>();
  const cyclicRows = new Set<number>();
  for (const l of links) {
    const s = endId(l.source);
    const t = endId(l.target);
    const row = rowOf.get(s);
    const col = rowOf.get(t);
    if (s === t || row === undefined || col === undefined) continue;
    const inCycle = compOf.get(s) === compOf.get(t);
    if (row === col) {
      if (inCycle) cyclicRows.add(row);
      continue;
    }
    const key = `${row}:${col}`;
    const prev = cells.get(key);
    if (!prev) {
      cells.set(key, { row, col, weight: l.weight, count: 1, type: l.type, inCycle, samples: [[s, t]] });
      continue;
    }
    prev.weight += l.weight;
    prev.count += 1;
    prev.type = strongerLink(prev.type, l.type);
    prev.inCycle ||= inCycle;
    if (prev.samples.length < SAMPLES) prev.samples.push([s, t]);
  }
  return { cells: [...cells.values()], cycles: sccs.filter((c) => c.length > 1), cyclicRows };
}

function folderDepths(root: Folder): Array<{ path: string; depth: number }> {
  const out: Array<{ path: string; depth: number }> = [];
  const walk = (folder: Folder, depth: number) => {
    for (const item of folder.children) {
      if (item.kind === 'folder') {
        out.push({ path: item.folder.path, depth });
        walk(item.folder, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Folders to collapse so the rows fit `budget`: everything below the deepest cut that fits,
 * or the top-level folders when nothing smaller does. Empty when the open tree already fits.
 */
export function autoCollapse(root: Folder, budget: number): Set<string> {
  const folders = folderDepths(root);
  if (visibleRows(root, new Set()).rows.length <= budget) return new Set();
  const deepest = Math.max(0, ...folders.map((f) => f.depth));
  let cut = new Set<string>();
  for (let depth = deepest; depth >= 0; depth--) {
    cut = new Set(folders.filter((f) => f.depth >= depth).map((f) => f.path));
    if (visibleRows(root, cut).rows.length <= budget) return cut;
  }
  return cut;
}

export function cycleSpans(rows: readonly Row[], cycles: readonly string[][]): CycleSpan[] {
  const rowOf = new Map<string, number>();
  rows.forEach((r, i) => r.members.forEach((id) => rowOf.set(id, i)));
  return cycles.map((members) => {
    const at = [...new Set(members.map((id) => rowOf.get(id)).filter((i): i is number => i !== undefined))].sort((a, b) => a - b);
    return { members, rows: at, contiguous: at.length > 0 && at[at.length - 1] - at[0] + 1 === at.length };
  });
}

/** Folder paths, outermost first, that must be expanded to show `id` as its own row. */
export function ancestorsOf(root: Folder, id: string): string[] {
  const walk = (folder: Folder, trail: string[]): string[] | null => {
    for (const item of folder.children) {
      if (item.kind === 'leaf') {
        if (item.id === id) return trail;
      } else {
        const found = walk(item.folder, [...trail, item.folder.path]);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(root, []) ?? [];
}
