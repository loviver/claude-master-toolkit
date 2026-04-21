import { readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { output, outputError, isJsonMode } from '../../shared/output.js';
import { parseJsonlForBench } from '../../shared/bench/ingest.js';
import { insertRun, insertTask, selectRunsWithTurns, selectTasks } from '../../shared/bench/persist.js';
import { exportToSql } from '../../shared/bench/export.js';
import { importFromSql } from '../../shared/bench/import_.js';
import { compareTask } from '../../shared/bench/compare.js';
import { readGitProvenance } from '../../shared/bench/provenance.js';
import type { BenchVariant } from '../../shared/bench/types.js';
import type {
  BenchTaskAddOpts,
  BenchIngestOpts,
  BenchListOpts,
  BenchCompareOpts,
  BenchExportOpts,
} from '../types/bench-opts.js';

function dbPath(): string {
  return (
    process.env['CTK_DB_PATH'] ??
    join(homedir(), '.claude', 'state', 'claude-master-toolkit', 'ctk.sqlite')
  );
}

function openDb(): Database.Database {
  const p = dbPath();
  mkdirSync(join(p, '..'), { recursive: true });
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function requireVariant(v: string | undefined): BenchVariant {
  if (v !== 'ctk' && v !== 'baseline') {
    outputError(`--variant must be 'ctk' or 'baseline', got '${v}'`);
    throw new Error('unreachable');
  }
  return v;
}

// ── task ──

export async function benchTaskAddCommand(
  id: string,
  opts: BenchTaskAddOpts,
): Promise<void> {
  if (!opts.name) return outputError('bench task add: --name is required');
  const db = openDb();
  try {
    let oracleJson: string | null = null;
    if (opts.oracle) {
      const raw = await readFile(opts.oracle, 'utf-8');
      oracleJson = raw.trim();
    }
    insertTask(db, {
      id,
      name: opts.name,
      description: opts.description ?? null,
      oracleJson,
      createdAt: Date.now(),
    });
    output({ task: { id, name: opts.name } });
  } finally {
    db.close();
  }
}

export function benchTaskListCommand(): void {
  const db = openDb();
  try {
    const tasks = selectTasks(db);
    if (isJsonMode()) {
      output({ tasks });
    } else {
      if (tasks.length === 0) {
        console.log('(no bench tasks)');
        return;
      }
      for (const t of tasks) {
        console.log(`${t.id}  ${t.name}${t.description ? '  — ' + t.description : ''}`);
      }
    }
  } finally {
    db.close();
  }
}

export function benchTaskRemoveCommand(id: string): void {
  const db = openDb();
  try {
    const res = db.prepare('DELETE FROM bench_tasks WHERE id = ?').run(id);
    output({ removed: res.changes });
  } finally {
    db.close();
  }
}

// ── ingest ──

export async function benchIngestCommand(
  jsonlPath: string,
  opts: BenchIngestOpts,
): Promise<void> {
  if (!opts.task) return outputError('bench ingest: --task is required');
  const variant = requireVariant(opts.variant);

  const db = openDb();
  try {
    const taskExists = db.prepare('SELECT 1 FROM bench_tasks WHERE id = ?').get(opts.task);
    if (!taskExists) {
      return outputError(`task '${opts.task}' not found. Run: ctk bench task add <id> --name ...`);
    }

    const prov = readGitProvenance();
    const run = await parseJsonlForBench(jsonlPath, {
      taskId: opts.task,
      variant,
      model: opts.model,
      notes: opts.notes,
      success: opts.success === undefined ? undefined : Number(opts.success),
      author: prov.author ?? undefined,
      commit: prov.commit ?? undefined,
    });

    const res = insertRun(db, run);
    output({
      inserted: res.inserted,
      runId: run.id,
      taskId: run.taskId,
      variant: run.variant,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costUsd: Number(run.costUsd.toFixed(6)),
      turnCount: run.turnCount,
      checksum: run.checksum,
      duplicate: !res.inserted,
    });
  } finally {
    db.close();
  }
}

// ── list / show ──

export function benchListCommand(opts: BenchListOpts): void {
  const db = openDb();
  try {
    const variant = opts.variant ? requireVariant(opts.variant) : undefined;
    let rows = selectRunsWithTurns(db, opts.task);
    if (variant) rows = rows.filter((r) => r.variant === variant);

    if (isJsonMode()) {
      output({
        runs: rows.map(({ turns: _t, ...rest }) => rest),
      });
    } else {
      if (rows.length === 0) {
        console.log('(no runs)');
        return;
      }
      for (const r of rows) {
        console.log(
          `${r.id.slice(0, 8)}  ${r.taskId}  ${r.variant}  in=${r.inputTokens}  out=${r.outputTokens}  cost=$${r.costUsd.toFixed(4)}  turns=${r.turnCount}`,
        );
      }
    }
  } finally {
    db.close();
  }
}

export function benchShowCommand(runId: string): void {
  const db = openDb();
  try {
    const runs = selectRunsWithTurns(db);
    const run = runs.find((r) => r.id === runId || r.id.startsWith(runId));
    if (!run) return outputError(`run '${runId}' not found`);
    output(run);
  } finally {
    db.close();
  }
}

// ── compare ──

export function benchCompareCommand(opts: BenchCompareOpts): void {
  if (!opts.task) return outputError('bench compare: --task is required');
  const db = openDb();
  try {
    const res = compareTask(db, opts.task);
    if (isJsonMode()) {
      output(res);
    } else {
      console.log(`\nTask: ${res.taskId}`);
      for (const v of res.variants) {
        console.log(`\n  ${v.variant}  n=${v.n}`);
        if (v.n === 0) continue;
        const m = v.metrics;
        console.log(
          `    input_tokens  avg=${m.input_tokens.avg.toFixed(0)}  p50=${m.input_tokens.p50}  p95=${m.input_tokens.p95}`,
        );
        console.log(
          `    output_tokens avg=${m.output_tokens.avg.toFixed(0)}  p50=${m.output_tokens.p50}  p95=${m.output_tokens.p95}`,
        );
        console.log(
          `    cost_usd      avg=$${m.cost_usd.avg.toFixed(4)}  p50=$${m.cost_usd.p50.toFixed(4)}  p95=$${m.cost_usd.p95.toFixed(4)}`,
        );
        console.log(
          `    wall_ms       avg=${m.wall_ms.avg.toFixed(0)}  p50=${m.wall_ms.p50}  p95=${m.wall_ms.p95}`,
        );
        console.log(
          `    turn_count    avg=${m.turn_count.avg.toFixed(1)}  p50=${m.turn_count.p50}  p95=${m.turn_count.p95}`,
        );
      }
      if (Object.keys(res.delta).length > 0) {
        console.log(`\n  delta (ctk vs baseline):`);
        for (const [k, d] of Object.entries(res.delta)) {
          if (!d) continue;
          const rel = d.relative === null ? 'n/a' : `${(d.relative * 100).toFixed(1)}%`;
          console.log(`    ${k.padEnd(16)}  abs=${d.absolute.toFixed(4)}  rel=${rel}`);
        }
      }
      console.log('');
    }
  } finally {
    db.close();
  }
}

// ── export / import ──

export async function benchExportCommand(opts: BenchExportOpts): Promise<void> {
  const db = openDb();
  try {
    const sql = exportToSql(db, { taskId: opts.task, includePaths: opts.includePaths });
    if (opts.out) {
      await writeFile(opts.out, sql, 'utf-8');
      output({ wrote: opts.out, bytes: Buffer.byteLength(sql, 'utf-8') });
    } else {
      process.stdout.write(sql);
    }
  } finally {
    db.close();
  }
}

export async function benchImportCommand(file: string): Promise<void> {
  const sql = await readFile(file, 'utf-8');
  const db = openDb();
  try {
    const res = importFromSql(db, sql, file);
    if (!res.checksumValid) {
      console.error('warning: checksum invalid — data may be corrupted');
    }
    output({
      ...res,
      importId: res.importId,
      sourceFile: file,
    });
    void randomUUID; // keep import stable
  } finally {
    db.close();
  }
}
