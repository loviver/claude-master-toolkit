import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { BENCH_SCHEMA_SQL } from '../schema-sql.js';
import { insertRun, insertTask } from '../persist.js';
import { compareTask } from '../compare.js';
import type { BenchRun } from '../types.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(BENCH_SCHEMA_SQL);
  return db;
}

function mkRun(id: string, variant: 'ctk' | 'baseline', inputTokens: number, cost: number): BenchRun {
  return {
    id,
    taskId: 't1',
    variant,
    model: 'claude-sonnet-4-6',
    sourceJsonl: null,
    sessionId: 's',
    startedAt: 0,
    endedAt: 1000,
    wallMs: 1000,
    inputTokens,
    outputTokens: 0,
    cacheRead: 0,
    cacheCreation: 0,
    costUsd: cost,
    turnCount: 1,
    stopReason: 'end_turn',
    toolCallsJson: '[]',
    success: 1,
    notes: null,
    checksum: id, // unique per run to bypass UNIQUE constraint
    provenanceAuthor: null,
    provenanceCommit: null,
    importedFrom: null,
    createdAt: 0,
    turns: [],
  };
}

describe('compareTask', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
    insertTask(db, {
      id: 't1',
      name: 'x',
      description: null,
      oracleJson: null,
      createdAt: 0,
    });
  });

  it('computes avg + delta across variants', () => {
    insertRun(db, mkRun('c1', 'ctk', 100, 0.01));
    insertRun(db, mkRun('c2', 'ctk', 200, 0.02));
    insertRun(db, mkRun('b1', 'baseline', 500, 0.05));
    insertRun(db, mkRun('b2', 'baseline', 700, 0.07));

    const res = compareTask(db, 't1');

    const ctk = res.variants.find((v) => v.variant === 'ctk')!;
    const base = res.variants.find((v) => v.variant === 'baseline')!;
    expect(ctk.n).toBe(2);
    expect(base.n).toBe(2);
    expect(ctk.metrics.input_tokens.avg).toBe(150);
    expect(base.metrics.input_tokens.avg).toBe(600);

    // ctk uses fewer tokens → relative delta negative
    expect(res.delta.input_tokens!.absolute).toBe(-450);
    expect(res.delta.input_tokens!.relative).toBeCloseTo(-0.75, 5);
    expect(res.delta.cost_usd!.relative).toBeCloseTo(-0.75, 5);
  });

  it('handles empty variant gracefully', () => {
    insertRun(db, mkRun('c1', 'ctk', 100, 0.01));
    const res = compareTask(db, 't1');
    expect(res.variants.find((v) => v.variant === 'baseline')!.n).toBe(0);
    expect(res.delta.input_tokens).toBeUndefined();
  });

  it('computes p50 and p95 from sorted samples', () => {
    for (let i = 1; i <= 20; i++) insertRun(db, mkRun('c' + i, 'ctk', i * 10, 0));
    const res = compareTask(db, 't1');
    const ctk = res.variants.find((v) => v.variant === 'ctk')!;
    expect(ctk.n).toBe(20);
    // p50 of 10..200 step 10 → index 10 → 110
    expect(ctk.metrics.input_tokens.p50).toBe(110);
    // p95 of 20 sorted → index 19 → 200
    expect(ctk.metrics.input_tokens.p95).toBe(200);
  });
});
