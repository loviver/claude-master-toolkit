import type Database from 'better-sqlite3';
import { parseQualifiedId, qualifyId } from './ids.js';

/**
 * The def/ref graph the indexer stores, read once: one node per qualified symbol and
 * one edge per resolved call (`deps`), type/const reference (`refs`) or supertype
 * (`heritage`), plus the `dispatch` edges a call through a supertype implies. Shared by
 * the repo map (ranking) and the code graph (rendering) so both see the same edges.
 */

export interface SymbolRow {
  file: string;
  symbol: string;
  kind: string;
  signature: string | null;
  exported: number;
  start_line: number;
  end_line: number;
  deps: string | null;
  refs: string | null;
  heritage: string | null;
}

/**
 * `inherit` points from a subtype to the type it extends/implements; `dispatch` from a
 * caller to an override or implementation its call may land on at runtime.
 */
export type SymbolEdgeType = 'call' | 'ref' | 'inherit' | 'dispatch';

/** Call edges outweigh type/const references when ranking. */
export const EDGE_WEIGHT: Record<SymbolEdgeType, number> = { call: 1, dispatch: 1, ref: 0.5, inherit: 0.5 };

export interface SymbolEdge {
  from: string;
  to: string;
  type: SymbolEdgeType;
}

export interface SymbolGraph {
  byId: Map<string, SymbolRow>;
  edges: SymbolEdge[];
  /** Edges dropped per source id: bare ids (dynamic dispatch) or targets outside the index. */
  dropped: Map<string, number>;
}

const parseList = (json: string | null): string[] => (json ? (JSON.parse(json) as string[]) : []);

/** Indexes built before schema v6 (and hand-made test fixtures) have no heritage column. */
function heritageColumn(db: Database.Database): string {
  const cols = db.prepare('PRAGMA table_info(symbols)').all() as { name: string }[];
  return cols.some((c) => c.name === 'heritage') ? 'heritage' : 'NULL AS heritage';
}

/** Every transitive subtype of each type, from the direct `heritage` lists. */
function subtypeIndex(byId: Map<string, SymbolRow>): (type: string) => string[] {
  const direct = new Map<string, string[]>();
  for (const [id, r] of byId) {
    for (const sup of parseList(r.heritage)) (direct.get(sup) ?? direct.set(sup, []).get(sup)!).push(id);
  }
  const memo = new Map<string, string[]>();
  return (type) => {
    const hit = memo.get(type);
    if (hit) return hit;
    const seen = new Set<string>();
    const stack = [...(direct.get(type) ?? [])];
    while (stack.length > 0) {
      const sub = stack.pop()!;
      if (seen.has(sub) || sub === type) continue;
      seen.add(sub);
      stack.push(...(direct.get(sub) ?? []));
    }
    const subs = [...seen];
    memo.set(type, subs);
    return subs;
  };
}

export function loadSymbolGraph(db: Database.Database, projectPath: string): SymbolGraph {
  const rows = db
    .prepare(
      `SELECT file, symbol, kind, signature, exported, start_line, end_line, deps, refs, ${heritageColumn(db)}
       FROM symbols WHERE project_path = ?`,
    )
    .all(projectPath) as SymbolRow[];

  const byId = new Map(rows.map((r) => [qualifyId(r.file, r.symbol), r]));
  const subtypesOf = subtypeIndex(byId);
  const edges: SymbolEdge[] = [];
  const dropped = new Map<string, number>();
  const drop = (from: string) => dropped.set(from, (dropped.get(from) ?? 0) + 1);

  /**
   * Class hierarchy analysis: a call to `T.m` may run any override of `m` in a subtype of
   * `T`. Over-approximates (all implementations, not the one picked at runtime), which is
   * the safe side for impact. A member the index has no node for (an interface method)
   * lands on its owner type instead, so the contract itself stays visible.
   */
  const addCall = (from: string, target: string) => {
    const q = parseQualifiedId(target);
    if (!q) return drop(from); // bare id: the resolver could not attribute it to a file
    const dot = q.symbol.lastIndexOf('.');
    const owner = dot > 0 ? qualifyId(q.file, q.symbol.slice(0, dot)) : null;
    let hit = false;
    if (byId.has(target)) {
      edges.push({ from, to: target, type: 'call' });
      hit = true;
    } else if (owner && byId.has(owner)) {
      edges.push({ from, to: owner, type: 'call' });
      hit = true;
    }
    if (owner) {
      const member = q.symbol.slice(dot + 1);
      for (const sub of subtypesOf(owner)) {
        const s = parseQualifiedId(sub)!;
        const impl = qualifyId(s.file, `${s.symbol}.${member}`);
        if (impl !== from && byId.has(impl)) {
          edges.push({ from, to: impl, type: 'dispatch' });
          hit = true;
        }
      }
    }
    if (!hit) drop(from);
  };

  const addEdges = (from: string, targets: string[], type: 'ref' | 'inherit') => {
    for (const target of targets) {
      // Targets outside the index have no node.
      if (parseQualifiedId(target) && byId.has(target)) edges.push({ from, to: target, type });
      else drop(from);
    }
  };

  for (const [id, r] of byId) {
    for (const target of parseList(r.deps)) addCall(id, target);
    addEdges(id, parseList(r.refs), 'ref');
    addEdges(id, parseList(r.heritage), 'inherit');
  }
  return { byId, edges, dropped };
}
