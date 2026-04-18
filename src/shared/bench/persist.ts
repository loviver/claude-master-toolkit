import type Database from 'better-sqlite3';
import type { BenchRun, BenchTask } from './types.js';

export function insertTask(db: Database.Database, t: BenchTask): void {
  db.prepare(
    `INSERT OR IGNORE INTO bench_tasks
      (id, name, description, oracle_json, created_at)
      VALUES (?, ?, ?, ?, ?)`,
  ).run(t.id, t.name, t.description, t.oracleJson, t.createdAt);
}

export function insertRun(db: Database.Database, run: BenchRun): { inserted: boolean } {
  const tx = db.transaction(() => {
    const res = db.prepare(
      `INSERT OR IGNORE INTO bench_runs
        (id, task_id, variant, model, source_jsonl, session_id,
         started_at, ended_at, wall_ms,
         input_tokens, output_tokens, cache_read, cache_creation, cost_usd,
         turn_count, stop_reason, tool_calls_json, success, notes,
         checksum, provenance_author, provenance_commit, imported_from, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      run.id, run.taskId, run.variant, run.model, run.sourceJsonl, run.sessionId,
      run.startedAt, run.endedAt, run.wallMs,
      run.inputTokens, run.outputTokens, run.cacheRead, run.cacheCreation, run.costUsd,
      run.turnCount, run.stopReason, run.toolCallsJson, run.success, run.notes,
      run.checksum, run.provenanceAuthor, run.provenanceCommit, run.importedFrom, run.createdAt,
    );

    if (res.changes === 0) return { inserted: false };

    const insertTurn = db.prepare(
      `INSERT OR IGNORE INTO bench_turns
        (run_id, turn_idx, role, timestamp, model,
         input_tokens, output_tokens, cache_read, cache_creation, cost_usd,
         tools_json, stop_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const t of run.turns) {
      insertTurn.run(
        run.id, t.turnIdx, t.role, t.timestamp, t.model,
        t.inputTokens, t.outputTokens, t.cacheRead, t.cacheCreation, t.costUsd,
        t.toolsJson, t.stopReason,
      );
    }
    return { inserted: true };
  });
  return tx();
}

export function selectTasks(db: Database.Database, ids?: string[]): BenchTask[] {
  const rows = ids && ids.length > 0
    ? (db.prepare(
        `SELECT id, name, description, oracle_json AS oracleJson, created_at AS createdAt
         FROM bench_tasks WHERE id IN (${ids.map(() => '?').join(',')})`,
      ).all(...ids) as BenchTask[])
    : (db.prepare(
        `SELECT id, name, description, oracle_json AS oracleJson, created_at AS createdAt
         FROM bench_tasks`,
      ).all() as BenchTask[]);
  return rows;
}

interface RunRowDb {
  id: string;
  taskId: string;
  variant: 'ctk' | 'baseline';
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

export function selectRunsWithTurns(
  db: Database.Database,
  taskId?: string,
): BenchRun[] {
  const runSql = `
    SELECT id, task_id AS taskId, variant, model, source_jsonl AS sourceJsonl, session_id AS sessionId,
      started_at AS startedAt, ended_at AS endedAt, wall_ms AS wallMs,
      input_tokens AS inputTokens, output_tokens AS outputTokens,
      cache_read AS cacheRead, cache_creation AS cacheCreation, cost_usd AS costUsd,
      turn_count AS turnCount, stop_reason AS stopReason, tool_calls_json AS toolCallsJson,
      success, notes, checksum,
      provenance_author AS provenanceAuthor, provenance_commit AS provenanceCommit,
      imported_from AS importedFrom, created_at AS createdAt
    FROM bench_runs
    ${taskId ? 'WHERE task_id = ?' : ''}
    ORDER BY created_at ASC
  `;
  const runs = taskId
    ? (db.prepare(runSql).all(taskId) as RunRowDb[])
    : (db.prepare(runSql).all() as RunRowDb[]);

  const turnStmt = db.prepare(
    `SELECT run_id AS runId, turn_idx AS turnIdx, role, timestamp, model,
      input_tokens AS inputTokens, output_tokens AS outputTokens,
      cache_read AS cacheRead, cache_creation AS cacheCreation, cost_usd AS costUsd,
      tools_json AS toolsJson, stop_reason AS stopReason
     FROM bench_turns WHERE run_id = ? ORDER BY turn_idx ASC`,
  );

  return runs.map((r) => ({
    ...r,
    turns: (turnStmt.all(r.id) as Array<{ runId: string } & Omit<BenchRun['turns'][0], never>>).map(
      ({ runId: _runId, ...rest }) => rest,
    ),
  }));
}
