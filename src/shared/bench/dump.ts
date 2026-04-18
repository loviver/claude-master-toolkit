import { createHash } from 'crypto';
import type { BenchRun, BenchTask, BenchTurn, BenchVariant } from './types.js';

const TASK_COLS = ['id', 'name', 'description', 'oracle_json', 'created_at'] as const;

const RUN_COLS = [
  'id', 'task_id', 'variant', 'model', 'source_jsonl', 'session_id',
  'started_at', 'ended_at', 'wall_ms',
  'input_tokens', 'output_tokens', 'cache_read', 'cache_creation', 'cost_usd',
  'turn_count', 'stop_reason', 'tool_calls_json', 'success', 'notes',
  'checksum', 'provenance_author', 'provenance_commit', 'imported_from', 'created_at',
] as const;

const TURN_COLS = [
  'run_id', 'turn_idx', 'role', 'timestamp', 'model',
  'input_tokens', 'output_tokens', 'cache_read', 'cache_creation', 'cost_usd',
  'tools_json', 'stop_reason',
] as const;

type SqlValue = string | number | null;

function sqlLit(v: SqlValue): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function taskRow(t: BenchTask): SqlValue[] {
  return [t.id, t.name, t.description, t.oracleJson, t.createdAt];
}

function runRow(r: BenchRun, includePaths: boolean): SqlValue[] {
  return [
    r.id, r.taskId, r.variant, r.model,
    includePaths ? r.sourceJsonl : null,
    r.sessionId,
    r.startedAt, r.endedAt, r.wallMs,
    r.inputTokens, r.outputTokens, r.cacheRead, r.cacheCreation, r.costUsd,
    r.turnCount, r.stopReason, r.toolCallsJson, r.success,
    includePaths ? r.notes : null,
    r.checksum, r.provenanceAuthor, r.provenanceCommit, r.importedFrom, r.createdAt,
  ];
}

function turnRow(runId: string, t: BenchTurn): SqlValue[] {
  return [
    runId, t.turnIdx, t.role, t.timestamp, t.model,
    t.inputTokens, t.outputTokens, t.cacheRead, t.cacheCreation, t.costUsd,
    t.toolsJson, t.stopReason,
  ];
}

function insertStmt(table: string, cols: readonly string[], row: SqlValue[]): string {
  return `INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${row.map(sqlLit).join(',')});`;
}

export interface EmitOptions {
  tasks: BenchTask[];
  runs: BenchRun[];
  author: string | null;
  commit: string | null;
  includePaths?: boolean;
}

export function emitSqlDump(opts: EmitOptions): string {
  const includePaths = !!opts.includePaths;
  const lines: string[] = [];
  lines.push('BEGIN TRANSACTION;');

  for (const t of opts.tasks) {
    lines.push(insertStmt('bench_tasks', TASK_COLS, taskRow(t)));
  }
  for (const r of opts.runs) {
    lines.push(insertStmt('bench_runs', RUN_COLS, runRow(r, includePaths)));
  }
  for (const r of opts.runs) {
    for (const turn of r.turns) {
      lines.push(insertStmt('bench_turns', TURN_COLS, turnRow(r.id, turn)));
    }
  }

  lines.push('COMMIT;');
  const body = lines.join('\n') + '\n';
  const rowCount =
    opts.tasks.length +
    opts.runs.length +
    opts.runs.reduce((n, r) => n + r.turns.length, 0);

  const checksum = createHash('sha256').update(body).digest('hex');
  const header = [
    '-- ctk bench export v1',
    `-- author: ${opts.author ?? ''}`,
    `-- commit: ${opts.commit ?? ''}`,
    `-- exported_at: ${new Date().toISOString()}`,
    `-- checksum: ${checksum}`,
    `-- rows: ${rowCount}`,
  ].join('\n') + '\n';

  return header + body;
}

// ── Parse ──

export interface DumpHeader {
  author: string | null;
  commit: string | null;
  exportedAt: string | null;
  checksum: string;
  rows: number;
}

export interface ParsedDump {
  header: DumpHeader;
  tasks: BenchTask[];
  runs: ParsedRun[];
  turns: ParsedTurn[];
  checksumValid: boolean;
}

export interface ParsedRun {
  id: string;
  taskId: string;
  variant: BenchVariant;
  model: string;
  sourceJsonl: string | null;
  sessionId: string | null;
  startedAt: number;
  endedAt: number;
  wallMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number;
  turnCount: number;
  stopReason: string | null;
  toolCallsJson: string | null;
  success: number | null;
  notes: string | null;
  checksum: string;
  provenanceAuthor: string | null;
  provenanceCommit: string | null;
  importedFrom: string | null;
  createdAt: number;
}

export interface ParsedTurn {
  runId: string;
  turnIdx: number;
  role: string;
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number;
  toolsJson: string | null;
  stopReason: string | null;
}

function tokenizeValues(inside: string): SqlValue[] {
  const out: SqlValue[] = [];
  let i = 0;
  while (i < inside.length) {
    while (i < inside.length && /\s/.test(inside[i]!)) i++;
    if (i >= inside.length) break;

    const ch = inside[i]!;
    if (ch === "'") {
      // quoted string with '' escapes
      let s = '';
      i++;
      while (i < inside.length) {
        if (inside[i] === "'" && inside[i + 1] === "'") {
          s += "'";
          i += 2;
        } else if (inside[i] === "'") {
          i++;
          break;
        } else {
          s += inside[i];
          i++;
        }
      }
      out.push(s);
    } else {
      // NULL or number — read until comma or end
      let raw = '';
      while (i < inside.length && inside[i] !== ',') {
        raw += inside[i];
        i++;
      }
      raw = raw.trim();
      if (raw.toUpperCase() === 'NULL') {
        out.push(null);
      } else {
        const n = Number(raw);
        out.push(Number.isNaN(n) ? raw : n);
      }
    }

    while (i < inside.length && /\s/.test(inside[i]!)) i++;
    if (inside[i] === ',') i++;
  }
  return out;
}

function extractValues(line: string): SqlValue[] {
  const m = line.match(/VALUES\s*\((.*)\);\s*$/);
  if (!m) return [];
  return tokenizeValues(m[1]!);
}

export function parseSqlDump(sql: string): ParsedDump {
  const lines = sql.split('\n');
  const headerLines: string[] = [];
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith('-- ')) {
      headerLines.push(lines[i]!);
    } else {
      bodyStart = i;
      break;
    }
  }

  if (headerLines.length === 0 || !headerLines[0]!.includes('ctk bench export')) {
    throw new Error('parseSqlDump: missing or malformed header');
  }

  const header: DumpHeader = {
    author: null,
    commit: null,
    exportedAt: null,
    checksum: '',
    rows: 0,
  };
  for (const h of headerLines) {
    const m = h.match(/^--\s+(\w+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const val = m[2]!.trim();
    if (key === 'author') header.author = val || null;
    else if (key === 'commit') header.commit = val || null;
    else if (key === 'exported_at') header.exportedAt = val || null;
    else if (key === 'checksum') header.checksum = val;
    else if (key === 'rows') header.rows = Number(val);
  }

  const body = lines.slice(bodyStart).join('\n');
  const actualChecksum = createHash('sha256').update(body).digest('hex');
  const checksumValid = !!header.checksum && header.checksum === actualChecksum;

  const tasks: BenchTask[] = [];
  const runs: ParsedRun[] = [];
  const turns: ParsedTurn[] = [];

  for (const line of lines.slice(bodyStart)) {
    if (line.includes('INSERT OR IGNORE INTO bench_tasks')) {
      const v = extractValues(line);
      tasks.push({
        id: String(v[0]),
        name: String(v[1]),
        description: v[2] === null ? null : String(v[2]),
        oracleJson: v[3] === null ? null : String(v[3]),
        createdAt: Number(v[4]),
      });
    } else if (line.includes('INSERT OR IGNORE INTO bench_runs')) {
      const v = extractValues(line);
      runs.push({
        id: String(v[0]),
        taskId: String(v[1]),
        variant: String(v[2]) as BenchVariant,
        model: String(v[3]),
        sourceJsonl: v[4] === null ? null : String(v[4]),
        sessionId: v[5] === null ? null : String(v[5]),
        startedAt: Number(v[6]),
        endedAt: Number(v[7]),
        wallMs: Number(v[8]),
        inputTokens: Number(v[9]),
        outputTokens: Number(v[10]),
        cacheRead: Number(v[11]),
        cacheCreation: Number(v[12]),
        costUsd: Number(v[13]),
        turnCount: Number(v[14]),
        stopReason: v[15] === null ? null : String(v[15]),
        toolCallsJson: v[16] === null ? null : String(v[16]),
        success: v[17] === null ? null : Number(v[17]),
        notes: v[18] === null ? null : String(v[18]),
        checksum: String(v[19]),
        provenanceAuthor: v[20] === null ? null : String(v[20]),
        provenanceCommit: v[21] === null ? null : String(v[21]),
        importedFrom: v[22] === null ? null : String(v[22]),
        createdAt: Number(v[23]),
      });
    } else if (line.includes('INSERT OR IGNORE INTO bench_turns')) {
      const v = extractValues(line);
      turns.push({
        runId: String(v[0]),
        turnIdx: Number(v[1]),
        role: String(v[2]),
        timestamp: Number(v[3]),
        model: String(v[4]),
        inputTokens: Number(v[5]),
        outputTokens: Number(v[6]),
        cacheRead: Number(v[7]),
        cacheCreation: Number(v[8]),
        costUsd: Number(v[9]),
        toolsJson: v[10] === null ? null : String(v[10]),
        stopReason: v[11] === null ? null : String(v[11]),
      });
    }
  }

  return { header, tasks, runs, turns, checksumValid };
}
