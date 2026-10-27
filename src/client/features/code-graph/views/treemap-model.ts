import type { CodeGraphFileDTO } from '../../../lib/types';
import { buildFileTree, type TreeDir } from '../explorer-model';

export interface Rect { x: number; y: number; w: number; h: number }

interface Item { id: string; value: number }
export type Tile<T extends Item = Item> = T & Rect;

function worst(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/** Squarified treemap (Bruls et al.): tiles close to squares, area proportional to value. */
export function squarify<T extends Item>(items: readonly T[], rect: Rect): Array<Tile<T>> {
  const queue = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = queue.reduce((n, i) => n + i.value, 0);
  if (queue.length === 0 || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const area = (i: T) => i.value * scale;
  const out: Array<Tile<T>> = [];
  let r = { ...rect };
  while (queue.length) {
    const side = Math.min(r.w, r.h);
    let take = 1;
    while (take < queue.length
      && worst(queue.slice(0, take + 1).map(area), side) <= worst(queue.slice(0, take).map(area), side)) take++;
    const row = queue.splice(0, take);
    const sum = row.reduce((n, i) => n + area(i), 0);
    if (r.w >= r.h) {
      const w = sum / r.h;
      let y = r.y;
      for (const i of row) { const h = area(i) / w; out.push({ ...i, x: r.x, y, w, h }); y += h; }
      r = { x: r.x + w, y: r.y, w: r.w - w, h: r.h };
    } else {
      const h = sum / r.w;
      let x = r.x;
      for (const i of row) { const w = area(i) / h; out.push({ ...i, x, y: r.y, w, h }); x += w; }
      r = { x: r.x, y: r.y + h, w: r.w, h: r.h - h };
    }
  }
  return out;
}

export interface TreemapCell extends Rect {
  kind: 'dir' | 'file';
  path: string;
  name: string;
  depth: number;
  value: number;
  changed: boolean;
}

export const HEADER = 16;
const PAD = 2;
/** Smallest folder (px) worth drawing its children in. */
const MIN_NEST = 36;

function weight(dir: TreeDir): number {
  return dir.files.reduce((n, f) => n + Math.max(1, f.symbols), 0) + dir.dirs.reduce((n, d) => n + weight(d), 0);
}

function findDir(dir: TreeDir, path: string): TreeDir | null {
  if (dir.path === path) return dir;
  for (const d of dir.dirs) if (path === d.path || path.startsWith(`${d.path}/`)) return findDir(d, path);
  return null;
}

/** Folders nested in folders, files sized by symbol count. `zoom` roots the map at a folder. */
export function layoutTreemap(
  files: readonly CodeGraphFileDTO[],
  changed: ReadonlySet<string>,
  rect: Rect,
  zoom?: string,
): TreemapCell[] {
  const tree = buildFileTree([...files], changed);
  const root = (zoom && findDir(tree, zoom)) || tree;
  const cells: TreemapCell[] = [];
  const place = (dir: TreeDir, into: Rect, depth: number) => {
    const kids: Array<Item & { dir?: TreeDir; file?: TreeDir['files'][number] }> = [
      ...dir.dirs.map((d) => ({ id: d.path, value: weight(d), dir: d })),
      ...dir.files.map((f) => ({ id: f.path, value: Math.max(1, f.symbols), file: f })),
    ];
    for (const tile of squarify(kids, into)) {
      const { x, y, w, h } = tile;
      if (tile.dir) {
        cells.push({ kind: 'dir', path: tile.dir.path, name: tile.dir.name, depth, x, y, w, h, value: tile.value, changed: tile.dir.changed > 0 });
        if (w > MIN_NEST && h > MIN_NEST) place(tile.dir, { x: x + PAD, y: y + HEADER, w: w - 2 * PAD, h: h - HEADER - PAD }, depth + 1);
      } else if (tile.file) {
        cells.push({ kind: 'file', path: tile.file.path, name: tile.file.name, depth, x, y, w, h, value: tile.value, changed: tile.file.changed });
      }
    }
  };
  place(root, rect, 0);
  return cells;
}
