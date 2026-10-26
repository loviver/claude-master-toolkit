import type Database from 'better-sqlite3';
import { parseQualifiedId, qualifyId } from './ids.js';

/**
 * The def/ref graph the indexer stores, read once: one node per qualified symbol and
 * one edge per resolved call (`deps`) or type/const reference (`refs`). Shared by the
 * repo map (ranking) and the code graph (rendering) so both see the same edges.
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
}

export type SymbolEdgeType = 'call' | 'ref';

/** Call edges outweigh type/const references when ranking. */
export const EDGE_WEIGHT: Record<SymbolEdgeType, number> = { call: 1, ref: 0.5 };

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

export function loadSymbolGraph(db: Database.Database, projectPath: string): SymbolGraph {
  const rows = db
    .prepare(
      `SELECT file, symbol, kind, signature, exported, start_line, end_line, deps, refs
       FROM symbols WHERE project_path = ?`,
    )
    .all(projectPath) as SymbolRow[];

  const byId = new Map(rows.map((r) => [qualifyId(r.file, r.symbol), r]));
  const edges: SymbolEdge[] = [];
  const dropped = new Map<string, number>();
  const addEdges = (from: string, json: string | null, type: SymbolEdgeType) => {
    for (const target of json ? (JSON.parse(json) as string[]) : []) {
      // Bare ids are unresolved (dynamic dispatch); targets outside the index have no node.
      if (parseQualifiedId(target) && byId.has(target)) edges.push({ from, to: target, type });
      else dropped.set(from, (dropped.get(from) ?? 0) + 1);
    }
  };
  for (const [id, r] of byId) {
    addEdges(id, r.deps, 'call');
    addEdges(id, r.refs, 'ref');
  }
  return { byId, edges, dropped };
}
