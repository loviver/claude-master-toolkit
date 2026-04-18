import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { BENCH_SCHEMA_SQL } from '../schema-sql.js';
import { insertRun, insertTask, selectRunsWithTurns } from '../persist.js';
import { exportToSql } from '../export.js';
import { importFromSql } from '../import_.js';
import type { BenchRun, BenchTask } from '../types.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(BENCH_SCHEMA_SQL);
  return db;
}

const task: BenchTask = {
  id: 't1',
  name: 'refactor-auth',
  description: 'extract middleware',
  oracleJson: null,
  createdAt: 1_700_000_000_000,
};

function mkRun(overrides: Partial<BenchRun> = {}): BenchRun {
  return {
    id: 'run-abc',
    taskId: 't1',
    variant: 'ctk',
    model: 'claude-sonnet-4-6',
    sourceJsonl: '/tmp/x.jsonl',
    sessionId: 'sess1',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_020_000,
    wallMs: 20_000,
    inputTokens: 220,
    outputTokens: 50,
    cacheRead: 1100,
    cacheCreation: 50,
    costUsd: 0.0019275,
    turnCount: 1,
    stopReason: 'end_turn',
    toolCallsJson: '["Read"]',
    success: 1,
    notes: 'n',
    checksum: 'abc123',
    provenanceAuthor: 'alice@example.com',
    provenanceCommit: 'deadbeef',
    importedFrom: null,
    createdAt: 1_700_000_030_000,
    turns: [
      {
        turnIdx: 0,
        role: 'assistant',
        timestamp: 1_700_000_010_000,
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 20,
        cacheRead: 500,
        cacheCreation: 0,
        costUsd: 0.00075,
        toolsJson: '["Read"]',
        stopReason: 'tool_use',
      },
    ],
    ...overrides,
  };
}

describe('export → import round-trip', () => {
  let src: Database.Database;
  beforeEach(() => {
    src = freshDb();
    insertTask(src, task);
    insertRun(src, mkRun());
  });

  it('exportToSql then importFromSql into fresh DB preserves runs + turns', () => {
    const sql = exportToSql(src, { taskId: 't1', author: 'alice@x', commit: 'cafebabecafebabe' });

    const dst = freshDb();
    const res = importFromSql(dst, sql, '/tmp/exported.sql');

    expect(res.checksumValid).toBe(true);
    expect(res.tasksInserted).toBe(1);
    expect(res.runsInserted).toBe(1);
    expect(res.turnsInserted).toBe(1);

    const runs = selectRunsWithTurns(dst, 't1');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.inputTokens).toBe(220);
    expect(runs[0]!.turns).toHaveLength(1);
    // Paths redacted by default
    expect(runs[0]!.sourceJsonl).toBeNull();
    // imported_from is sealed by importer using header, not row payload
    expect(runs[0]!.importedFrom).toBe('alice@x@cafebab');
  });

  it('import is idempotent: second import does not duplicate', () => {
    const sql = exportToSql(src, { taskId: 't1', author: 'a@b', commit: 'c' });
    const dst = freshDb();
    const first = importFromSql(dst, sql, '/tmp/x.sql');
    const second = importFromSql(dst, sql, '/tmp/x.sql');

    expect(first.runsInserted).toBe(1);
    expect(second.runsInserted).toBe(0);

    const count = dst.prepare('SELECT COUNT(*) AS n FROM bench_runs').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('UNIQUE(task_id, variant, checksum) prevents duplicate ingest of same JSONL', () => {
    const dst = freshDb();
    insertTask(dst, task);
    const r1 = insertRun(dst, mkRun({ id: 'run-1' }));
    const r2 = insertRun(dst, mkRun({ id: 'run-2' })); // same checksum, same task, same variant

    expect(r1.inserted).toBe(true);
    expect(r2.inserted).toBe(false);

    const count = dst.prepare('SELECT COUNT(*) AS n FROM bench_runs').get() as { n: number };
    expect(count.n).toBe(1);
  });
});
