import type Database from 'better-sqlite3';
import { parseQualifiedId, qualifyId } from './ids.js';

/**
 * Repo map: the project's most structurally important symbols, ranked by PageRank over
 * the def/ref graph the indexer already stores, cut to a token budget. Answers "where do
 * I start?" in one call instead of a round of exploratory reads (the Aider repo-map idea).
 */

const DAMPING = 0.85;
const MAX_ITERATIONS = 30;
const TOLERANCE = 1e-9;
/** Call edges outweigh type/const references when ranking. */
const DEP_WEIGHT = 1;
const REF_WEIGHT = 0.5;
const DEFAULT_BUDGET = 1024;

type Edge = [from: string, to: string, weight: number];

/**
 * Weighted PageRank. `focus` personalizes the teleport vector (uniform when absent or
 * empty); dangling mass is redistributed along it too, so the result sums to 1.
 */
export function rankSymbols(nodes: string[], edges: Edge[], focus?: Set<string>): Map<string, number> {
  const n = nodes.length;
  const rank = new Map<string, number>();
  if (n === 0) return rank;

  const seeds = focus?.size ? nodes.filter((id) => focus.has(id)) : nodes;
  const teleport = new Map(seeds.map((id) => [id, 1 / seeds.length]));

  const out = new Map<string, Array<[string, number]>>();
  const outWeight = new Map<string, number>();
  for (const [from, to, w] of edges) {
    if (from === to) continue;
    (out.get(from) ?? out.set(from, []).get(from)!).push([to, w]);
    outWeight.set(from, (outWeight.get(from) ?? 0) + w);
  }

  for (const id of nodes) rank.set(id, teleport.get(id) ?? 0);
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let dangling = 0;
    for (const id of nodes) if (!outWeight.has(id)) dangling += rank.get(id)!;

    const next = new Map<string, number>();
    for (const id of nodes) next.set(id, ((1 - DAMPING) + DAMPING * dangling) * (teleport.get(id) ?? 0));
    for (const [from, targets] of out) {
      const share = (DAMPING * rank.get(from)!) / outWeight.get(from)!;
      for (const [to, w] of targets) next.set(to, next.get(to)! + share * w);
    }

    let delta = 0;
    for (const id of nodes) delta += Math.abs(next.get(id)! - rank.get(id)!);
    for (const [id, v] of next) rank.set(id, v);
    if (delta < TOLERANCE) break;
  }
  return rank;
}

export interface RepoMapSymbol {
  symbol: string;
  kind: string;
  signature: string | null;
}

export interface RepoMapResult {
  /** Files in rank order of their best symbol; symbols in rank order within a file. */
  files: Array<{ file: string; symbols: RepoMapSymbol[] }>;
  /** True when the budget cut symbols off. */
  truncated: boolean;
  totalSymbols: number;
}

interface MapRow {
  file: string;
  symbol: string;
  kind: string;
  signature: string | null;
  deps: string | null;
  refs: string | null;
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

function matchesFocus(row: MapRow, focus: string[]): boolean {
  return focus.some((f) => row.file === f || row.file.endsWith(`/${f}`) || row.symbol === f);
}

export function repoMap(
  db: Database.Database,
  projectPath: string,
  opts: { focus?: string[]; budget?: number } = {},
): RepoMapResult {
  const rows = db
    .prepare(`SELECT file, symbol, kind, signature, deps, refs FROM symbols WHERE project_path = ?`)
    .all(projectPath) as MapRow[];
  if (rows.length === 0) return { files: [], truncated: false, totalSymbols: 0 };

  const byId = new Map(rows.map((r) => [qualifyId(r.file, r.symbol), r]));
  const edges: Edge[] = [];
  const addEdges = (from: string, json: string | null, weight: number) => {
    for (const target of json ? (JSON.parse(json) as string[]) : []) {
      // Bare ids are unresolved (dynamic dispatch) and targets outside the index carry no rank.
      if (parseQualifiedId(target) && byId.has(target)) edges.push([from, target, weight]);
    }
  };
  for (const [id, r] of byId) {
    addEdges(id, r.deps, DEP_WEIGHT);
    addEdges(id, r.refs, REF_WEIGHT);
  }

  const focus = opts.focus?.length
    ? new Set([...byId].filter(([, r]) => matchesFocus(r, opts.focus!)).map(([id]) => id))
    : undefined;
  const rank = rankSymbols([...byId.keys()], edges, focus);
  const ranked = [...byId.keys()].sort((a, b) => rank.get(b)! - rank.get(a)! || a.localeCompare(b));

  // Greedy fill: always keep the top symbol, stop at the first one that overflows.
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const files = new Map<string, RepoMapSymbol[]>();
  let used = 0;
  let taken = 0;
  for (const id of ranked) {
    const r = byId.get(id)!;
    const cost =
      estimateTokens(`${r.symbol} ${r.kind} ${r.signature ?? ''}`) + 3 +
      (files.has(r.file) ? 0 : estimateTokens(r.file) + 2);
    if (taken > 0 && used + cost > budget) break;
    used += cost;
    taken++;
    const list = files.get(r.file) ?? files.set(r.file, []).get(r.file)!;
    list.push({ symbol: r.symbol, kind: r.kind, signature: r.signature });
  }

  return {
    files: [...files].map(([file, symbols]) => ({ file, symbols })),
    truncated: taken < ranked.length,
    totalSymbols: ranked.length,
  };
}
