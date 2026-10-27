import type Database from 'better-sqlite3';
import type {
  CodeGraphSymbolDTO,
  CodeGraphSymbolHitDTO,
  CodeGraphSymbolRefDTO,
  CodeGraphUsageDTO,
} from '../api-types.js';
import { parseQualifiedId, qualifyId } from './ids.js';
import { loadSymbolGraph, type SymbolGraph, type SymbolRow } from './symbol-graph.js';

/**
 * IDE-style navigation over the AST index: project-wide Go to Symbol, and one symbol's
 * usages, callees and type hierarchy. Reads the same edges the code graph draws, so
 * "Find usages" and the graph never disagree.
 */

export const SEARCH_LIMIT = 50;
export const SEARCH_MAX = 200;

const memberName = (symbol: string) => symbol.slice(symbol.lastIndexOf('.') + 1);

/** Words of an identifier: `getCodeGraph` → get/Code/Graph, `HTMLParser` → HTML/Parser, `use_code` → use/code. */
const words = (name: string) => name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [];

/** IntelliJ's CamelHumps: the query is a run of prefixes of the name's words, in order. */
function humps(query: string, ws: string[], qi = 0, wi = 0): boolean {
  if (qi === query.length) return true;
  for (let w = wi; w < ws.length; w++) {
    const word = ws[w];
    for (let k = Math.min(word.length, query.length - qi); k > 0; k--) {
      if (word.slice(0, k) === query.slice(qi, qi + k) && humps(query, ws, qi + k, w + 1)) return true;
    }
  }
  return false;
}

/**
 * How well `query` names `symbol`, lower is better: 0 exact, 1 prefix, 2 camel humps,
 * 3 substring; null for no match. Case-insensitive. A query without a dot matches a
 * method by its member name, as IDEs do.
 */
export function symbolMatchScore(query: string, symbol: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const target = q.includes('.') ? symbol : memberName(symbol);
  const t = target.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (humps(q, words(target).map((w) => w.toLowerCase()))) return 2;
  if (t.includes(q)) return 3;
  return null;
}

type HitRow = Pick<SymbolRow, 'file' | 'symbol' | 'kind' | 'signature' | 'exported' | 'start_line' | 'end_line'>;

function toRef(file: string, symbol: string, row: Pick<SymbolRow, 'kind' | 'start_line' | 'end_line'>): CodeGraphSymbolRefDTO {
  return { id: qualifyId(file, symbol), symbol, kind: row.kind, file, startLine: row.start_line, endLine: row.end_line };
}

function toHit(row: HitRow): CodeGraphSymbolHitDTO {
  return { ...toRef(row.file, row.symbol, row), exported: Boolean(row.exported), signature: row.signature };
}

/** Project-wide Go to Symbol: best match first, exported before internal, shorter names before longer. */
export function searchSymbols(db: Database.Database, projectPath: string, query: string, limit = SEARCH_LIMIT): CodeGraphSymbolHitDTO[] {
  if (!query.trim()) return [];
  const rows = db
    .prepare(
      `SELECT file, symbol, kind, signature, exported, start_line, end_line
       FROM symbols WHERE project_path = ?`,
    )
    .all(projectPath) as HitRow[];
  const scored: Array<[HitRow, number]> = [];
  for (const r of rows) {
    const score = symbolMatchScore(query, r.symbol);
    if (score !== null) scored.push([r, score]);
  }
  return scored
    .sort(([a, sa], [b, sb]) =>
      sa - sb ||
      b.exported - a.exported ||
      a.symbol.length - b.symbol.length ||
      a.file.localeCompare(b.file) ||
      a.start_line - b.start_line)
    .slice(0, Math.min(Math.max(1, limit), SEARCH_MAX))
    .map(([r]) => toHit(r));
}

const byLocation = (a: CodeGraphSymbolRefDTO, b: CodeGraphSymbolRefDTO) =>
  a.file.localeCompare(b.file) || a.startLine - b.startLine || a.symbol.localeCompare(b.symbol);

/**
 * Lines inside a caller where it reaches `target`. A call the resolver pinned on an owner
 * (`Svc` for an unindexed `Svc.m`) or a dispatch to an override (`Impl.m` for a call to
 * `Base.m`) has no site keyed by `target`, so it borrows the sites of the call it came from.
 */
function siteLines(sites: Record<string, number[]> | null, target: string, type: string): number[] {
  if (!sites) return [];
  const member = memberName(parseQualifiedId(target)?.symbol ?? target);
  const lines = new Set<number>();
  for (const [key, at] of Object.entries(sites)) {
    const hit = key === target ||
      key.startsWith(`${target}.`) ||
      (type === 'dispatch' && memberName(parseQualifiedId(key)?.symbol ?? key) === member);
    if (hit) at.forEach((l) => lines.add(l));
  }
  return [...lines].sort((a, b) => a - b);
}

/**
 * Everything around one symbol, off the def/ref graph. `graph` lets a caller reuse a
 * graph it already loaded for this index revision.
 */
export function symbolDetails(
  db: Database.Database,
  projectPath: string,
  id: string,
  graph: SymbolGraph = loadSymbolGraph(db, projectPath),
): CodeGraphSymbolDTO | null {
  const row = graph.byId.get(id);
  if (!row) return null;

  const sitesStmt = db.prepare(`SELECT dep_sites FROM symbols WHERE project_path = ? AND file = ? AND symbol = ? LIMIT 1`);
  const sitesOf = (sid: string): Record<string, number[]> | null => {
    const q = parseQualifiedId(sid)!;
    const r = sitesStmt.get(projectPath, q.file, q.symbol) as { dep_sites: string | null } | undefined;
    return r?.dep_sites ? (JSON.parse(r.dep_sites) as Record<string, number[]>) : null;
  };
  const ref = (sid: string) => {
    const r = graph.byId.get(sid)!;
    return toRef(r.file, r.symbol, r);
  };

  // A call and a dispatch can join the same pair: merge them into one usage, direct if either is.
  const usages = () => new Map<string, CodeGraphUsageDTO>();
  const addUsage = (into: Map<string, CodeGraphUsageDTO>, sid: string, lines: number[], type: string) => {
    const known = into.get(sid);
    const u = known ?? into.set(sid, { ...ref(sid), lines: [], ...(type === 'dispatch' && { dispatch: true as const }) }).get(sid)!;
    if (known && type !== 'dispatch') delete u.dispatch;
    u.lines = [...new Set([...u.lines, ...lines])].sort((a, b) => a - b);
  };
  const callers = usages();
  const callees = usages();
  const refs = { referrers: new Set<string>(), references: new Set<string>(), supertypes: new Set<string>(), subtypes: new Set<string>() };
  const ownSites = sitesOf(id);

  for (const e of graph.edges) {
    if (e.from === e.to) continue;
    const call = e.type === 'call' || e.type === 'dispatch';
    if (e.to === id) {
      if (call) addUsage(callers, e.from, siteLines(sitesOf(e.from), id, e.type), e.type);
      else (e.type === 'ref' ? refs.referrers : refs.subtypes).add(e.from);
    } else if (e.from === id) {
      if (call) addUsage(callees, e.to, siteLines(ownSites, e.to, e.type), e.type);
      else (e.type === 'ref' ? refs.references : refs.supertypes).add(e.to);
    }
  }

  const prefix = `${row.symbol}.`;
  const members: CodeGraphSymbolRefDTO[] = [];
  for (const r of graph.byId.values()) {
    if (r.file === row.file && r.symbol.startsWith(prefix) && !r.symbol.slice(prefix.length).includes('.')) {
      members.push(toRef(r.file, r.symbol, r));
    }
  }

  const list = (ids: Set<string>) => [...ids].map(ref).sort(byLocation);
  return {
    ...toHit(row),
    callers: [...callers.values()].sort(byLocation),
    referrers: list(refs.referrers),
    callees: [...callees.values()].sort(byLocation),
    references: list(refs.references),
    supertypes: list(refs.supertypes),
    subtypes: list(refs.subtypes),
    members: members.sort((a, b) => a.startLine - b.startLine || a.symbol.localeCompare(b.symbol)),
  };
}
