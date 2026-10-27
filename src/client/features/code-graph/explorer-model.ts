import type { CodeGraphFileDTO, CodeGraphLevel } from '../../lib/types';

/**
 * Pure model of the explorer around the graph: the file tree, where a file lives in
 * each level of the graph, and the deterministic seed layout of the 2D view.
 */

export interface TreeFile {
  kind: 'file';
  name: string;
  path: string;
  symbols: number;
  changed: boolean;
}

export interface TreeDir {
  kind: 'dir';
  /** Display name; a chain of single-child folders collapses into `a/b/c`. */
  name: string;
  path: string;
  dirs: TreeDir[];
  files: TreeFile[];
  /** Files anywhere below. */
  fileCount: number;
  /** Changed files anywhere below. */
  changed: number;
}

function newDir(name: string, path: string): TreeDir {
  return { kind: 'dir', name, path, dirs: [], files: [], fileCount: 0, changed: 0 };
}

function finish(dir: TreeDir): TreeDir {
  dir.dirs = dir.dirs.map(finish).sort((a, b) => a.name.localeCompare(b.name));
  dir.files.sort((a, b) => a.name.localeCompare(b.name));
  dir.fileCount = dir.files.length + dir.dirs.reduce((n, d) => n + d.fileCount, 0);
  dir.changed = dir.files.filter((f) => f.changed).length + dir.dirs.reduce((n, d) => n + d.changed, 0);
  // Compact folders: `src` holding only `client` reads as `src/client`, like an editor does.
  if (dir.path !== '' && dir.files.length === 0 && dir.dirs.length === 1) {
    const only = dir.dirs[0];
    return { ...only, name: `${dir.name}/${only.name}` };
  }
  return dir;
}

export function buildFileTree(files: CodeGraphFileDTO[], changed: ReadonlySet<string>): TreeDir {
  const root = newDir('', '');
  const dirs = new Map<string, TreeDir>([['', root]]);
  const dirAt = (path: string): TreeDir => {
    const hit = dirs.get(path);
    if (hit) return hit;
    const cut = path.lastIndexOf('/');
    const dir = newDir(path.slice(cut + 1), path);
    dirAt(cut < 0 ? '' : path.slice(0, cut)).dirs.push(dir);
    dirs.set(path, dir);
    return dir;
  };
  for (const f of files) {
    const cut = f.file.lastIndexOf('/');
    dirAt(cut < 0 ? '' : f.file.slice(0, cut)).files.push({
      kind: 'file',
      name: f.file.slice(cut + 1),
      path: f.file,
      symbols: f.symbols,
      changed: changed.has(f.file),
    });
  }
  return finish(root);
}

/** Every ancestor folder of `file`: what to expand so it shows in the tree. */
export function ancestorDirs(file: string): string[] {
  const parts = file.split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

export function matchFiles(files: CodeGraphFileDTO[], query: string, max = 50): CodeGraphFileDTO[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<[CodeGraphFileDTO, number]> = [];
  for (const f of files) {
    const path = f.file.toLowerCase();
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (name.startsWith(q)) scored.push([f, 0]);
    else if (path.includes(q)) scored.push([f, 1]);
  }
  return scored
    .sort(([a, ta], [b, tb]) => ta - tb || a.file.localeCompare(b.file))
    .slice(0, max)
    .map(([f]) => f);
}

/** The node that stands for `file` at `level`; at symbol level a file is many nodes, so none. */
export function nodeIdForFile(level: CodeGraphLevel, file: string): string | null {
  switch (level) {
    case 'module': {
      const cut = file.lastIndexOf('/');
      return cut < 0 ? '.' : file.slice(0, cut);
    }
    case 'file':   return file;
    case 'symbol': return null;
  }
}

/** Node ids the current view draws for `file`, most ranked first (several at the symbol level). */
export function fileNodeIds(
  level: CodeGraphLevel,
  file: string,
  nodes: ReadonlyArray<{ id: string; file?: string | null; rank: number }>,
): string[] {
  const id = nodeIdForFile(level, file);
  return nodes
    .filter((n) => (id === null ? n.file === file : n.id === id))
    .sort((a, b) => b.rank - a.rank)
    .map((n) => n.id);
}

/** Whether a changed line span overlaps a 1-based line. */
export function lineChanged(line: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([start, end]) => line >= start && line <= end);
}

// ── 2D seed layout ──

/** FNV-1a: a stable 32-bit hash, so a view seeds the same way on every load. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Radius of the ring zones are seeded on, and of the scatter around each zone's centre. */
const ZONE_RING = 100;
const ZONE_SCATTER = 30;

/**
 * Initial position: zones (groups) evenly on a ring, members scattered around their
 * zone's centre. ForceAtlas2 then starts from islands instead of untangling a hairball.
 */
export function seedPosition(id: string, zone: number, zones: number): { x: number; y: number } {
  const h = hashString(id);
  const zoneAngle = zones > 1 ? (2 * Math.PI * zone) / zones : 0;
  const ring = zones > 1 ? ZONE_RING : 0;
  const angle = ((h & 0xffff) / 0xffff) * 2 * Math.PI;
  const dist = ((h >>> 16) / 0xffff) * ZONE_SCATTER;
  return {
    x: ring * Math.cos(zoneAngle) + dist * Math.cos(angle),
    y: ring * Math.sin(zoneAngle) + dist * Math.sin(angle),
  };
}
