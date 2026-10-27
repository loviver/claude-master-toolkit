import type Database from 'better-sqlite3';
import type {
  CodeGraphChangeDTO,
  CodeGraphChangedFileDTO,
  CodeGraphChangeStatus,
  CodeGraphDirection,
  CodeGraphDTO,
  CodeGraphFileDTO,
  CodeGraphLevel,
  CodeGraphLinkDTO,
  CodeGraphNodeDTO,
  CodeGraphOutlineDTO,
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
  /** Keep only files under this path (whole segments: `src/feat` excludes `src/featured`). Ignored with `focus`. */
  scope?: string;
  /**
   * Node id at `level`, or a folder: returns the neighbourhood within `depth` hops of that
   * node, or of every node under the folder (whole segments, like `scope`).
   */
  focus?: string;
  /** Explicit seed node ids at `level` (e.g. the branch diff); wins over `focus`. Unknown ids are skipped. */
  focusIds?: readonly string[];
  depth?: number;
  /** Edges the focus walk follows; `both` by default. */
  direction?: CodeGraphDirection;
  limit?: number;
  /** Commits per file (see `fileChurn`); omitted means churn 0 everywhere. */
  churn?: ReadonlyMap<string, number>;
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
  const base = { id, rank: 0, size: 0, exported: false, indexedAt: 0, loc: 0, callers: 0, churn: 0, group: groupOf(dir) };
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

/** BFS from `seeds`, at most `depth` hops, along the edges `direction` names. */
function neighbourhood(
  seeds: string[],
  links: CodeGraphLinkDTO[],
  depth: number,
  direction: CodeGraphDirection,
): Set<string> {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
  for (const l of links) {
    if (direction !== 'callers') link(l.source, l.target);
    if (direction !== 'deps') link(l.target, l.source);
  }
  const seen = new Set(seeds);
  let frontier = [...seeds];
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
  const { level } = opts;
  // Impact is project-wide: a scope would hide the focus or its callers outside the folder.
  const focused = opts.focus !== undefined || opts.focusIds !== undefined;
  const scope = focused ? undefined : opts.scope;
  const graph = loadSymbolGraph(db, projectPath);
  const indexTimes = fileIndexTimes(db, projectPath);

  const owner = new Map<string, string>();
  const nodes = new Map<string, CodeGraphNodeDTO>();
  const files = new Map<string, Set<string>>();
  let unresolved = 0;
  for (const [id, row] of graph.byId) {
    if (!inScope(row.file, scope)) continue;
    const cid = containerId(level, row.file, row.symbol);
    owner.set(id, cid);
    const node = nodes.get(cid) ?? nodes.set(cid, newNode(level, cid, row)).get(cid)!;
    node.size++;
    node.exported ||= Boolean(row.exported);
    node.indexedAt = Math.max(node.indexedAt, indexTimes.get(row.file) ?? 0);
    node.loc += row.end_line - row.start_line + 1;
    (files.get(cid) ?? files.set(cid, new Set()).get(cid)!).add(row.file);
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

  const fanIn = new Map<string, Set<string>>();
  for (const l of links) (fanIn.get(l.target) ?? fanIn.set(l.target, new Set()).get(l.target)!).add(l.source);
  for (const [id, node] of nodes) {
    node.callers = fanIn.get(id)?.size ?? 0;
    // A module counts each of its files once, however many symbols they hold.
    if (opts.churn) for (const f of files.get(id)!) node.churn += opts.churn.get(f) ?? 0;
  }

  const rank = rankSymbols(
    [...nodes.keys()],
    links.map((l) => [l.source, l.target, l.weight * EDGE_WEIGHT[l.type]]),
  );
  const top = Math.max(0, ...rank.values());
  for (const [id, node] of nodes) node.rank = top > 0 ? rank.get(id)! / top : 0;

  let candidates = [...nodes.keys()];
  let seeds = new Set<string>();
  if (focused) {
    const { focus, focusIds } = opts;
    seeds = new Set(focusIds
      ? focusIds.filter((id) => nodes.has(id))
      : nodes.has(focus!)
        ? [focus!]
        : [...nodes.values()].filter((n) => inScope(n.file ?? n.id, focus!)).map((n) => n.id));
    candidates = [...neighbourhood([...seeds], links, opts.depth ?? DEFAULT_DEPTH, opts.direction ?? 'both')];
  }

  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const kept = candidates
    .sort((a, b) =>
      Number(seeds.has(b)) - Number(seeds.has(a)) ||
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
      ...(focused && { focusMatches: seeds.size }),
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

export function indexedFiles(db: Database.Database, projectPath: string): CodeGraphFileDTO[] {
  return db
    .prepare(
      `SELECT f.file AS file, f.indexed_at AS indexedAt,
              (SELECT COUNT(*) FROM symbols s WHERE s.project_path = f.project_path AND s.file = f.file) AS symbols
       FROM indexed_files f
       WHERE f.project_path = ?
       ORDER BY f.file`,
    )
    .all(projectPath) as CodeGraphFileDTO[];
}

/** Whether `file` is in the index: the only files the source endpoint will read. */
export function isIndexedFile(db: Database.Database, projectPath: string, file: string): boolean {
  return !!db.prepare(`SELECT 1 FROM indexed_files WHERE project_path = ? AND file = ?`).get(projectPath, file);
}

export function fileOutline(db: Database.Database, projectPath: string, file: string): CodeGraphOutlineDTO[] {
  const rows = db
    .prepare(
      `SELECT symbol, kind, start_line AS startLine, end_line AS endLine
       FROM symbols WHERE project_path = ? AND file = ?
       ORDER BY start_line, symbol`,
    )
    .all(projectPath, file) as Array<Omit<CodeGraphOutlineDTO, 'id'>>;
  return rows.map((r) => ({ id: qualifyId(file, r.symbol), ...r }));
}

const PRISM_LANGUAGES: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  py: 'python', go: 'go', rs: 'rust', json: 'json', sql: 'sql', c: 'c', h: 'c', swift: 'swift',
};

/** The code viewer's grammar for a path, by extension. */
export function sourceLanguage(file: string): string | null {
  const dot = file.lastIndexOf('.');
  return dot < 0 ? null : PRISM_LANGUAGES[file.slice(dot + 1).toLowerCase()] ?? null;
}

interface RiskTouch {
  file: string;
  symbol: string;
  /** Qualified caller ids off the index; bare (unresolved) ones are skipped. */
  callers: string[];
}

interface RiskTouchDetail extends RiskTouch {
  exported: boolean;
  deps: string[];
  range: [number, number];
}

interface RiskRange {
  file: string;
  start: number;
  end: number;
  added: number;
  removed: number;
}

/** Lines of `[start, end]` not covered by any of `cover`, as inclusive spans. */
function uncovered([start, end]: [number, number], cover: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let from = start;
  for (let line = start; line <= end + 1; line++) {
    const covered = line <= end && cover.some(([s, e]) => line >= s && line <= e);
    if (line > end || covered) {
      if (line > from) out.push([from, line - 1]);
      from = line + 1;
    }
  }
  return out;
}

/**
 * The diff as the explorer lists it: touched symbols (most-called first, each with its
 * changed lines, the untouched callers it puts at risk and what it uses) and per file the
 * changed spans, including those no symbol covers.
 */
export function riskChanges(
  touched: RiskTouchDetail[],
  ranges: RiskRange[],
): { changes: CodeGraphChangeDTO[]; files: CodeGraphChangedFileDTO[] } {
  const touchedIds = new Set(touched.map((t) => qualifyId(t.file, t.symbol)));
  const qualified = (ids: string[], drop: (id: string) => boolean) =>
    [...new Set(ids.filter((id) => parseQualifiedId(id) && !drop(id)))].sort();
  const changes = touched
    .map((t) => {
      const id = qualifyId(t.file, t.symbol);
      const [lo, hi] = t.range;
      const hits = ranges.filter((r) => r.file === t.file && r.start <= hi && r.end >= lo);
      const spans = hits.map((r): [number, number] => [Math.max(r.start, lo), Math.min(r.end, hi)]);
      return {
        id,
        file: t.file,
        symbol: t.symbol,
        exported: t.exported,
        startLine: lo,
        endLine: hi,
        callers: qualified(t.callers, (c) => touchedIds.has(c)),
        deps: qualified(t.deps, (d) => d === id),
        ranges: spans,
        // A pure deletion is a zero-width touch: it marks the spot, it adds no line.
        added: hits.reduce((n, r, i) => n + (r.added ? spans[i][1] - spans[i][0] + 1 : 0), 0),
        removed: hits.reduce((n, r) => n + r.removed, 0),
      };
    })
    .sort((a, b) => b.callers.length - a.callers.length || a.id.localeCompare(b.id));

  const byFile = new Map<string, CodeGraphChangedFileDTO>();
  for (const r of ranges) {
    const f = byFile.get(r.file) ?? byFile.set(r.file, { file: r.file, ranges: [], added: 0, removed: 0, outside: [] }).get(r.file)!;
    f.ranges.push([r.start, r.end]);
    f.added += r.added;
    f.removed += r.removed;
    const cover = touched.filter((t) => t.file === r.file).map((t) => t.range);
    f.outside.push(...uncovered([r.start, r.end], cover));
  }
  const files = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
  return { changes, files };
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

/**
 * Git status per touched node of a level. A container (file, module) is `added` only when
 * every touched file under it is; files the status map misses count as modified.
 */
export function projectStatus(
  level: CodeGraphLevel,
  touched: RiskTouch[],
  files: ReadonlyMap<string, 'added' | 'modified' | 'deleted'>,
): Record<string, CodeGraphChangeStatus> {
  const out: Record<string, CodeGraphChangeStatus> = {};
  for (const t of touched) {
    const id = containerId(level, t.file, t.symbol);
    const status = files.get(t.file) === 'added' ? 'added' : 'modified';
    out[id] = out[id] === 'modified' ? 'modified' : status;
  }
  return out;
}
