import type Database from 'better-sqlite3';
import type {
  CodeGraphDTO,
  CodeGraphLevel,
  CodeGraphLinkDTO,
  CodeGraphNodeDTO,
  CodeGraphProjectDTO,
} from '../api-types.js';
import { parseQualifiedId, qualifyId } from './ids.js';
import { rankSymbols } from './repo-map.js';
import { EDGE_WEIGHT, loadSymbolGraph, type SymbolRow } from './symbol-graph.js';

/**
 * Code graph: the AST index projected onto one level of detail (module → file → symbol)
 * as nodes + weighted links, ready for a graph renderer. Pure over the DB — no layout,
 * no colors — so any view (3D, 2D, agent) consumes the same structure.
 *
 * Big repos (10k+ symbols) are tamed by projection, not by the renderer: aggregate to a
 * coarser level, narrow with `scope`, or walk a `focus` neighbourhood, then cap at `limit`.
 */

export const DEFAULT_DEPTH = 2;
export const DEFAULT_LIMIT = 2000;
export const MAX_LIMIT = 10_000;

export interface CodeGraphOptions {
  level: CodeGraphLevel;
  /** Keep only files under this path (whole segments: `src/feat` excludes `src/featured`). */
  scope?: string;
  /** Node id at `level`; returns its neighbourhood within `depth` hops, both directions. */
  focus?: string;
  depth?: number;
  limit?: number;
}

export type CodeGraph = Pick<CodeGraphDTO, 'level' | 'nodes' | 'links' | 'stats'>;

function dirOf(file: string): string {
  const i = file.lastIndexOf('/');
  return i < 0 ? '.' : file.slice(0, i);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function groupOf(dir: string): string {
  return dir === '.' ? '.' : dir.split('/').slice(0, 2).join('/');
}

function inScope(file: string, scope: string | undefined): boolean {
  if (!scope) return true;
  const s = scope.replace(/\/+$/, '');
  return file === s || file.startsWith(`${s}/`);
}

/** The node id a symbol folds into at `level`. */
export function containerId(level: CodeGraphLevel, file: string, symbol: string): string {
  switch (level) {
    case 'symbol': return qualifyId(file, symbol);
    case 'file':   return file;
    case 'module': return dirOf(file);
  }
}

function newNode(level: CodeGraphLevel, id: string, row: SymbolRow): CodeGraphNodeDTO {
  const dir = dirOf(row.file);
  const base = { id, rank: 0, size: 0, exported: false, indexedAt: 0, group: groupOf(dir) };
  switch (level) {
    case 'symbol':
      return {
        ...base, label: row.symbol, kind: row.kind, file: row.file,
        signature: row.signature, startLine: row.start_line, endLine: row.end_line,
      };
    case 'file':
      return { ...base, label: baseName(row.file), kind: 'file', file: row.file, signature: null, startLine: null, endLine: null };
    case 'module':
      return { ...base, label: dir === '.' ? '.' : baseName(dir), kind: 'module', file: null, signature: null, startLine: null, endLine: null };
  }
}

function fileIndexTimes(db: Database.Database, projectPath: string): Map<string, number> {
  const rows = db
    .prepare(`SELECT file, indexed_at FROM indexed_files WHERE project_path = ?`)
    .all(projectPath) as Array<{ file: string; indexed_at: number }>;
  return new Map(rows.map((r) => [r.file, r.indexed_at]));
}

/** Undirected BFS from `start`, at most `depth` hops. */
function neighbourhood(start: string, links: CodeGraphLinkDTO[], depth: number): Set<string> {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
  for (const l of links) {
    link(l.source, l.target);
    link(l.target, l.source);
  }
  const seen = new Set([start]);
  let frontier = [start];
  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of adj.get(id) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

export function buildCodeGraph(db: Database.Database, projectPath: string, opts: CodeGraphOptions): CodeGraph {
  const { level, scope } = opts;
  const graph = loadSymbolGraph(db, projectPath);
  const indexTimes = fileIndexTimes(db, projectPath);

  const owner = new Map<string, string>();
  const nodes = new Map<string, CodeGraphNodeDTO>();
  let unresolved = 0;
  for (const [id, row] of graph.byId) {
    if (!inScope(row.file, scope)) continue;
    const cid = containerId(level, row.file, row.symbol);
    owner.set(id, cid);
    const node = nodes.get(cid) ?? nodes.set(cid, newNode(level, cid, row)).get(cid)!;
    node.size++;
    node.exported ||= Boolean(row.exported);
    node.indexedAt = Math.max(node.indexedAt, indexTimes.get(row.file) ?? 0);
    unresolved += graph.dropped.get(id) ?? 0;
  }

  const folded = new Map<string, CodeGraphLinkDTO>();
  for (const e of graph.edges) {
    const source = owner.get(e.from);
    const target = owner.get(e.to);
    if (!source || !target || source === target) continue;
    const key = `${source}\0${target}\0${e.type}`;
    const link = folded.get(key) ?? folded.set(key, { source, target, type: e.type, weight: 0 }).get(key)!;
    link.weight++;
  }
  const links = [...folded.values()];

  const rank = rankSymbols(
    [...nodes.keys()],
    links.map((l) => [l.source, l.target, l.weight * EDGE_WEIGHT[l.type]]),
  );
  const top = Math.max(0, ...rank.values());
  for (const [id, node] of nodes) node.rank = top > 0 ? rank.get(id)! / top : 0;

  let candidates = [...nodes.keys()];
  if (opts.focus !== undefined) {
    candidates = nodes.has(opts.focus)
      ? [...neighbourhood(opts.focus, links, opts.depth ?? DEFAULT_DEPTH)]
      : [];
  }

  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const kept = candidates
    .sort((a, b) =>
      Number(b === opts.focus) - Number(a === opts.focus) ||
      nodes.get(b)!.rank - nodes.get(a)!.rank ||
      a.localeCompare(b))
    .slice(0, limit);
  const keptSet = new Set(kept);

  return {
    level,
    nodes: kept.map((id) => nodes.get(id)!),
    links: links.filter((l) => keptSet.has(l.source) && keptSet.has(l.target)),
    stats: {
      totalNodes: nodes.size,
      totalLinks: links.length,
      unresolved,
      truncated: kept.length < candidates.length,
    },
  };
}

/**
 * Cheap fingerprint of a project's index: changes whenever a file is (re)indexed or a
 * symbol appears/disappears. Lets a live view poll this instead of the whole graph.
 */
export function graphRevision(db: Database.Database, projectPath: string): string {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM symbols WHERE project_path = @p) AS symbols,
         (SELECT COUNT(*) FROM indexed_files WHERE project_path = @p) AS files,
         (SELECT COALESCE(MAX(indexed_at), 0) FROM indexed_files WHERE project_path = @p) AS latest`,
    )
    .get({ p: projectPath }) as { symbols: number; files: number; latest: number };
  return `${row.symbols}.${row.files}.${row.latest}`;
}

export function indexedProjects(db: Database.Database): CodeGraphProjectDTO[] {
  return db
    .prepare(
      `SELECT s.project_path AS projectPath,
              COUNT(*) AS symbols,
              COUNT(DISTINCT s.file) AS files,
              COALESCE((SELECT MAX(f.indexed_at) FROM indexed_files f WHERE f.project_path = s.project_path), 0) AS indexedAt
       FROM symbols s
       GROUP BY s.project_path
       ORDER BY symbols DESC, projectPath`,
    )
    .all() as CodeGraphProjectDTO[];
}

interface RiskTouch {
  file: string;
  symbol: string;
  /** Qualified caller ids off the index; bare (unresolved) ones are skipped. */
  callers: string[];
}

/**
 * Project a diff's touched symbols onto the node ids of `level`: what the branch changes,
 * and the blast radius (callers of changed code that are not changed themselves).
 */
export function projectRisk(level: CodeGraphLevel, touched: RiskTouch[]): { touched: string[]; blast: string[] } {
  const hit = new Set(touched.map((t) => containerId(level, t.file, t.symbol)));
  const blast = new Set<string>();
  for (const t of touched) {
    for (const caller of t.callers) {
      const parsed = parseQualifiedId(caller);
      if (!parsed) continue;
      const id = containerId(level, parsed.file, parsed.symbol);
      if (!hit.has(id)) blast.add(id);
    }
  }
  return { touched: [...hit].sort(), blast: [...blast].sort() };
}
