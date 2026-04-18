import type Database from 'better-sqlite3';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type {
  SymbolMatch,
  UnderstandResult,
  DepsResult,
  CallersResult,
  Finding,
  RecordFindingInput,
  RecallOpts,
  BriefData,
  BriefStatus,
  BriefValidation,
} from './types.js';

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
}

export function findSymbol(
  db: Database.Database,
  projectPath: string,
  name: string,
  opts: FindOpts = {},
): SymbolMatch[] {
  let sql = `SELECT * FROM symbols WHERE project_path = ? AND (symbol = ? OR symbol LIKE ?)`;
  const args: any[] = [projectPath, name, `%.${name}`];
  if (opts.kind) {
    sql += ` AND kind = ?`;
    args.push(opts.kind);
  }
  if (opts.exported) sql += ` AND exported = 1`;

  const rows = db.prepare(sql).all(...args) as SymbolRow[];
  return rows.map(rowToMatch);
}

export function getDeps(
  db: Database.Database,
  projectPath: string,
  file: string,
): DepsResult {
  const rows = db.prepare(
    `SELECT symbol, exported, deps FROM symbols WHERE project_path = ? AND file = ?`,
  ).all(projectPath, file) as Array<{ symbol: string; exported: number; deps: string | null }>;

  const exports: string[] = [];
  const allDeps = new Set<string>();
  for (const r of rows) {
    if (r.exported) exports.push(r.symbol);
    const d: string[] = r.deps ? JSON.parse(r.deps) : [];
    d.forEach((x) => allDeps.add(x));
  }
  return { file, exports, deps: Array.from(allDeps) };
}

export function getCallers(
  db: Database.Database,
  projectPath: string,
  name: string,
): CallersResult {
  const row = db.prepare(
    `SELECT callers FROM symbols WHERE project_path = ? AND (symbol = ? OR symbol LIKE ?) LIMIT 1`,
  ).get(projectPath, name, `%.${name}`) as { callers: string | null } | undefined;

  if (!row) return { symbol: name, callers: [] };

  const names: string[] = row.callers ? JSON.parse(row.callers) : [];
  if (names.length === 0) return { symbol: name, callers: [] };

  const placeholders = names.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT file, symbol, start_line FROM symbols WHERE project_path = ? AND symbol IN (${placeholders})`,
  ).all(projectPath, ...names) as Array<{ file: string; symbol: string; start_line: number }>;

  return {
    symbol: name,
    callers: rows.map((r) => ({ file: r.file, symbol: r.symbol, line: r.start_line })),
  };
}

export function understand(
  db: Database.Database,
  projectPath: string,
  name: string,
): UnderstandResult | null {
  const row = db.prepare(
    `SELECT * FROM symbols WHERE project_path = ? AND (symbol = ? OR symbol LIKE ?) LIMIT 1`,
  ).get(projectPath, name, `%.${name}`) as SymbolRow | undefined;

  if (!row) return null;

  const absFile = resolve(projectPath, row.file);
  let body = '';
  if (existsSync(absFile)) {
    const lines = readFileSync(absFile, 'utf-8').split('\n');
    body = lines.slice(row.start_line - 1, row.end_line).join('\n');
  }

  return { ...rowToMatch(row), body };
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
  return process.env['CLAUDE_SESSION_ID'] ?? process.env['CTK_SESSION_ID'] ?? 'default';
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

const BRIEFS_DIR = join(homedir(), '.claude', 'ctk', 'briefs');

function briefPath(id: string): string {
  return join(BRIEFS_DIR, `${id}.md`);
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
  mkdirSync(BRIEFS_DIR, { recursive: true });
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
