import type Database from 'better-sqlite3';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { ctkPaths } from '../paths/ctk-home.js';
import { currentSessionId as agentSessionId } from '../agents/resolve.js';
import { randomUUID } from 'crypto';
import type {
  SymbolMatch,
  UnderstandResult,
  DepsResult,
  CallersResult,
  CallerInfo,
  CallerDefinition,
  Finding,
  RecordFindingInput,
  RecallOpts,
  BriefData,
  BriefStatus,
  BriefValidation,
  FileImport,
} from './types.js';
import { parseQualifiedId } from './ids.js';

// ─── Symbol lookups ───────────────────────────────────────────

interface SymbolRow {
  file: string;
  symbol: string;
  kind: string;
  signature: string | null;
  start_line: number;
  end_line: number;
  exported: number;
  deps: string | null;
  callers: string | null;
  // Absent on pre-v3 rows/test fixtures.
  referrers?: string | null;
  tokens_estimate: number;
}

function rowToMatch(r: SymbolRow): SymbolMatch {
  return {
    file: r.file,
    symbol: r.symbol,
    kind: r.kind,
    signature: r.signature,
    range: [r.start_line, r.end_line],
    exported: !!r.exported,
    tokens: r.tokens_estimate,
    deps: r.deps ? JSON.parse(r.deps) : [],
    callers: r.callers ? JSON.parse(r.callers) : [],
  };
}

export interface FindOpts {
  kind?: string;
  exported?: boolean;
  /** Exact project-relative path, or a path suffix (`utils/formatters.ts`). */
  file?: string;
}

const RANK_KINDS = new Set(['function', 'class', 'interface', 'type']);

/**
 * Deterministic order for same-named definitions: exact name before a
 * `Class.name` suffix match, exported first, declaration-like kinds before
 * const/method, most callers, then file path. Replaces the old rowid-order `LIMIT 1`.
 */
function rankRows(rows: SymbolRow[], name: string): SymbolRow[] {
  const score = (r: SymbolRow) =>
    (r.symbol === name ? 0 : 4) + (r.exported ? 0 : 2) + (RANK_KINDS.has(r.kind) ? 0 : 1);
  // Popularity (caller count) breaks rank ties before path order: the most-used
  // definition is the likeliest target of a bare-name query.
  const popularity = (r: SymbolRow) => (r.callers ? (JSON.parse(r.callers) as unknown[]).length : 0);
  return [...rows].sort(
    (a, b) =>
      score(a) - score(b) ||
      popularity(b) - popularity(a) ||
      a.file.localeCompare(b.file) ||
      a.start_line - b.start_line,
  );
}

function fileMatches(rowFile: string, filter: string): boolean {
  return rowFile === filter || rowFile.endsWith(`/${filter}`);
}

function resolveCandidates(
  db: Database.Database,
  projectPath: string,
  name: string,
  opts: FindOpts = {},
): SymbolRow[] {
  let sql = `SELECT * FROM symbols WHERE project_path = ? AND (symbol = ? OR symbol LIKE ?)`;
  const args: any[] = [projectPath, name, `%.${name}`];
  if (opts.kind) {
    sql += ` AND kind = ?`;
    args.push(opts.kind);
  }
  if (opts.exported) sql += ` AND exported = 1`;

  let rows = db.prepare(sql).all(...args) as SymbolRow[];
  const f = opts.file;
  if (f) rows = rows.filter((r) => fileMatches(r.file, f));
  return rankRows(rows, name);
}

export function findSymbol(
  db: Database.Database,
  projectPath: string,
  name: string,
  opts: FindOpts = {},
): SymbolMatch[] {
  return resolveCandidates(db, projectPath, name, opts).map(rowToMatch);
}

export function getDeps(
  db: Database.Database,
  projectPath: string,
  file: string,
): DepsResult {
  const rows = db.prepare(
    `SELECT symbol, exported, deps, refs FROM symbols WHERE project_path = ? AND file = ?`,
  ).all(projectPath, file) as Array<{
    symbol: string;
    exported: number;
    deps: string | null;
    refs: string | null;
  }>;

  const exports: string[] = [];
  const allDeps = new Set<string>();
  const allRefs = new Set<string>();
  for (const r of rows) {
    if (r.exported) exports.push(r.symbol);
    const d: string[] = r.deps ? JSON.parse(r.deps) : [];
    d.forEach((x) => allDeps.add(x));
    const f: string[] = r.refs ? JSON.parse(r.refs) : [];
    f.forEach((x) => allRefs.add(x));
  }

  const imp = db.prepare(
    `SELECT imports FROM indexed_files WHERE project_path = ? AND file = ?`,
  ).get(projectPath, file) as { imports: string | null } | undefined;
  const imports: FileImport[] = imp?.imports ? JSON.parse(imp.imports) : [];

  return { file, exports, deps: Array.from(allDeps), refs: Array.from(allRefs), imports };
}

export function getCallers(
  db: Database.Database,
  projectPath: string,
  name: string,
  opts: { file?: string; include?: 'calls' | 'refs' | 'all' } = {},
): CallersResult {
  const include = opts.include ?? 'all';
  // Each matched definition keeps its own callers; the flat list is their union
  // (a bare query for a name defined in several files wants all of them).
  const defs = resolveCandidates(db, projectPath, name, { file: opts.file });

  // Qualified id → exact (file, symbol) lookup: no cross-file bleed. A bare id
  // (unresolved caller) falls back to every same-named symbol — best-effort.
  const lineStmt = db.prepare(
    `SELECT start_line FROM symbols WHERE project_path = ? AND file = ? AND symbol = ? LIMIT 1`,
  );
  const bareStmt = db.prepare(
    `SELECT file, symbol, start_line FROM symbols WHERE project_path = ? AND symbol = ?`,
  );

  const resolveIds = (ids: string[]): CallerInfo[] => {
    const out: CallerInfo[] = [];
    for (const id of ids) {
      const parsed = parseQualifiedId(id);
      if (parsed) {
        const row = lineStmt.get(projectPath, parsed.file, parsed.symbol) as
          | { start_line: number }
          | undefined;
        out.push({ file: parsed.file, symbol: parsed.symbol, line: row?.start_line ?? 0 });
      } else {
        const brows = bareStmt.all(projectPath, id) as Array<{
          file: string;
          symbol: string;
          start_line: number;
        }>;
        for (const b of brows) out.push({ file: b.file, symbol: b.symbol, line: b.start_line });
      }
    }
    return out;
  };

  const definitions: CallerDefinition[] = [];
  const seenCallers = new Set<string>();
  const seenReferrers = new Set<string>();
  const callers: CallerInfo[] = [];
  const referrers: CallerInfo[] = [];
  const union = (into: CallerInfo[], seen: Set<string>, from: CallerInfo[]) => {
    for (const c of from) {
      const key = `${c.file}::${c.symbol}::${c.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        into.push(c);
      }
    }
  };

  for (const d of defs) {
    const callIds: string[] = include !== 'refs' && d.callers ? JSON.parse(d.callers) : [];
    const refIds: string[] = include !== 'calls' && d.referrers ? JSON.parse(d.referrers) : [];
    const resolvedCalls = resolveIds(callIds);
    const resolvedRefs = resolveIds(refIds);
    definitions.push({ file: d.file, callers: resolvedCalls, referrers: resolvedRefs });
    union(callers, seenCallers, resolvedCalls);
    union(referrers, seenReferrers, resolvedRefs);
  }

  return { symbol: name, callers, referrers, definitions };
}

const UNDERSTAND_LIST_CAP = 15;
const ALTERNATIVES_CAP = 10;

export function understand(
  db: Database.Database,
  projectPath: string,
  name: string,
  opts: { file?: string } = {},
): UnderstandResult | null {
  const candidates = resolveCandidates(db, projectPath, name, { file: opts.file });
  const row = candidates[0];
  if (!row) return null;

  const absFile = resolve(projectPath, row.file);
  let body = '';
  if (existsSync(absFile)) {
    const lines = readFileSync(absFile, 'utf-8').split('\n');
    body = lines.slice(row.start_line - 1, row.end_line).join('\n');
  }

  const match = rowToMatch(row);
  const alternatives = candidates.slice(1, 1 + ALTERNATIVES_CAP).map((r) => ({
    file: r.file,
    symbol: r.symbol,
    kind: r.kind,
    range: [r.start_line, r.end_line] as [number, number],
  }));

  return {
    ...match,
    deps: match.deps.slice(0, UNDERSTAND_LIST_CAP),
    callers: match.callers.slice(0, UNDERSTAND_LIST_CAP),
    depsCount: match.deps.length,
    callersCount: match.callers.length,
    body,
    ambiguous: candidates.length > 1,
    alternatives,
  };
}

export function rawSlice(file: string, symbol: string): string | null {
  if (!existsSync(file)) return null;
  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const defPattern = new RegExp(
    `(function|const|let|var|class|func|def|fn|type|interface|export)\\s+${escaped}[\\s(<:=]`,
  );

  let inside = false;
  let depth = 0;
  let startLine = -1;
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inside && defPattern.test(line)) {
      inside = true;
      startLine = i;
      depth = 0;
    }
    if (inside) {
      out.push(`${i + 1}: ${line}`);
      for (const ch of line) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0 && i > startLine) return out.join('\n');
        }
      }
      if (line.trim() === '' && i > startLine + 1 && depth === 0) {
        out.pop();
        return out.join('\n');
      }
    }
  }
  return out.length > 0 ? out.join('\n') : null;
}

// ─── Findings pool ────────────────────────────────────────────

function currentSessionId(): string {
  return agentSessionId() ?? 'default';
}

export function recordFinding(
  db: Database.Database,
  input: RecordFindingInput,
): { id: number } {
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO findings (session_id, agent_role, type, symbol, file, finding, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.sessionId ?? currentSessionId(),
    input.agentRole ?? 'unknown',
    input.type,
    input.symbol ?? null,
    input.file ?? null,
    input.finding,
    input.confidence ?? 0.8,
    now,
  );
  return { id: result.lastInsertRowid as number };
}

export function recallFindings(
  db: Database.Database,
  opts: RecallOpts = {},
): Finding[] {
  const conds: string[] = [];
  const args: any[] = [];
  if (opts.type) { conds.push('type = ?'); args.push(opts.type); }
  if (opts.symbol) { conds.push('symbol = ?'); args.push(opts.symbol); }
  if (opts.sessionId) { conds.push('session_id = ?'); args.push(opts.sessionId); }
  if (opts.sinceMs) { conds.push('created_at >= ?'); args.push(Date.now() - opts.sinceMs); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT id, session_id, agent_role, type, symbol, file, finding, confidence, created_at
    FROM findings ${where} ORDER BY created_at DESC LIMIT 100
  `).all(...args) as Array<{
    id: number; session_id: string; agent_role: string; type: string;
    symbol: string | null; file: string | null; finding: string;
    confidence: number; created_at: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    agentRole: r.agent_role,
    type: r.type as Finding['type'],
    symbol: r.symbol,
    file: r.file,
    finding: r.finding,
    confidence: r.confidence,
    createdAt: r.created_at,
  }));
}

// ─── Brief protocol ───────────────────────────────────────────

const briefsDir = (): string => ctkPaths.briefsDir();

function briefPath(id: string): string {
  return join(briefsDir(), `${id}.md`);
}

const BRIEF_TEMPLATE = (id: string, task: string, createdAt: number) => `---
id: ${id}
status: active
created_at: ${createdAt}
---

# Task
${task}

# Constraints
- <rule>

# Known Context
- symbol: <name> | file: <path> | range: [a,b]

# Allowed Actions
- edit: <file> lines <a>-<b>
- read: ONLY via ctk_understand or ctk_slice — no Read on files >300L

# Unknowns
- <question>

# Success Criteria
- <verifiable condition>
`;

export function briefCreate(
  db: Database.Database,
  projectPath: string,
  id: string,
  task: string,
): BriefData {
  mkdirSync(briefsDir(), { recursive: true });
  const now = Date.now();
  const file = briefPath(id);

  if (!existsSync(file)) {
    writeFileSync(file, BRIEF_TEMPLATE(id, task, now), 'utf-8');
  }

  db.prepare(`
    INSERT OR IGNORE INTO briefs (id, project_path, task, status, created_at)
    VALUES (?, ?, ?, 'active', ?)
  `).run(id, projectPath, task, now);

  return {
    id,
    projectPath,
    task,
    constraints: [],
    knownContext: [],
    allowedActions: [],
    unknowns: [],
    successCriteria: [],
    status: 'active',
    createdAt: now,
  };
}

function parseBrief(content: string): Partial<BriefData> {
  const sections: Record<string, string[]> = {};
  let current: string | null = null;

  for (const line of content.split('\n')) {
    const h = line.match(/^#\s+(.+)$/);
    if (h) { current = h[1].trim(); sections[current] = []; continue; }
    if (current && line.trim().startsWith('-')) {
      sections[current].push(line.trim().slice(1).trim());
    }
  }

  return {
    task: (sections['Task']?.[0] ?? '').replace(/^-\s*/, ''),
    constraints: sections['Constraints'] ?? [],
    knownContext: (sections['Known Context'] ?? []).map((s) => ({ raw: s } as any)),
    allowedActions: (sections['Allowed Actions'] ?? []).map((s) => ({ raw: s } as any)),
    unknowns: sections['Unknowns'] ?? [],
    successCriteria: sections['Success Criteria'] ?? [],
  };
}

export function briefRead(
  db: Database.Database,
  id: string,
): BriefData | null {
  const row = db.prepare(
    `SELECT id, project_path, task, status, created_at FROM briefs WHERE id = ?`,
  ).get(id) as { id: string; project_path: string; task: string; status: string; created_at: number } | undefined;

  if (!row) return null;

  const file = briefPath(id);
  let parsed: Partial<BriefData> = {};
  if (existsSync(file)) {
    parsed = parseBrief(readFileSync(file, 'utf-8'));
  }

  return {
    id: row.id,
    projectPath: row.project_path,
    task: parsed.task || row.task,
    constraints: parsed.constraints ?? [],
    knownContext: parsed.knownContext ?? [],
    allowedActions: parsed.allowedActions ?? [],
    unknowns: parsed.unknowns ?? [],
    successCriteria: parsed.successCriteria ?? [],
    status: row.status as BriefStatus,
    createdAt: row.created_at,
  };
}

const PLACEHOLDER_RE = /^<.+>$/;

export function briefValidate(
  db: Database.Database,
  id: string,
): BriefValidation {
  const b = briefRead(db, id);
  if (!b) return { valid: false, missing: ['brief does not exist'] };

  const missing: string[] = [];
  const nonEmpty = (arr: string[]) =>
    arr.filter((s) => s.length > 0 && !PLACEHOLDER_RE.test(s));

  if (!b.task || PLACEHOLDER_RE.test(b.task)) missing.push('task');
  if (nonEmpty(b.constraints).length === 0) missing.push('constraints');
  if (nonEmpty(b.successCriteria).length === 0) missing.push('success_criteria');
  // Known Context and Allowed Actions are optional early on — warn but don't fail
  return { valid: missing.length === 0, missing };
}

export function briefFreeze(
  db: Database.Database,
  id: string,
): { id: string; status: BriefStatus } {
  db.prepare(`UPDATE briefs SET status = 'frozen' WHERE id = ?`).run(id);
  return { id, status: 'frozen' };
}
