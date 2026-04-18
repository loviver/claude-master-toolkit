import { describe, it, expect } from 'vitest';
import { emitSqlDump, parseSqlDump } from '../dump.js';
import type { BenchRun, BenchTask } from '../types.js';

const task: BenchTask = {
  id: 't1',
  name: 'refactor-auth',
  description: 'extract middleware',
  oracleJson: null,
  createdAt: 1_700_000_000_000,
};

const run: BenchRun = {
  id: 'run-abc',
  taskId: 't1',
  variant: 'ctk',
  model: 'claude-sonnet-4-6',
  sourceJsonl: '/home/user/secret/sess.jsonl',
  sessionId: 'sess1',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_020_000,
  wallMs: 20_000,
  inputTokens: 220,
  outputTokens: 50,
  cacheRead: 1100,
  cacheCreation: 50,
  costUsd: 0.0019275,
  turnCount: 2,
  stopReason: 'end_turn',
  toolCallsJson: '["Read"]',
  success: 1,
  notes: "sensitive note with 'quotes'",
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
};

describe('dump: emit + parse round-trip', () => {
  it('redacts source_jsonl and notes by default', () => {
    const sql = emitSqlDump({
      tasks: [task],
      runs: [run],
      author: 'alice@example.com',
      commit: 'deadbeef',
    });

    expect(sql).not.toContain('/home/user/secret');
    expect(sql).not.toContain('sensitive note');
    expect(sql).toContain("-- ctk bench export v1");
    expect(sql).toContain('BEGIN TRANSACTION;');
    expect(sql).toContain('COMMIT;');
  });

  it('opts.includePaths preserves source_jsonl and notes', () => {
    const sql = emitSqlDump({
      tasks: [task],
      runs: [run],
      author: 'alice@example.com',
      commit: 'deadbeef',
      includePaths: true,
    });

    expect(sql).toContain('/home/user/secret/sess.jsonl');
    expect(sql).toContain("sensitive note with ''quotes''"); // SQL-escaped
  });

  it('round-trips: parse(emit(x)) reproduces tasks/runs/turns (with redaction)', () => {
    const sql = emitSqlDump({
      tasks: [task],
      runs: [run],
      author: 'alice@example.com',
      commit: 'deadbeef',
    });

    const parsed = parseSqlDump(sql);

    expect(parsed.header.author).toBe('alice@example.com');
    expect(parsed.header.commit).toBe('deadbeef');
    expect(parsed.header.rows).toBe(3); // 1 task + 1 run + 1 turn
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0]!.id).toBe('t1');
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0]!.id).toBe('run-abc');
    expect(parsed.runs[0]!.sourceJsonl).toBeNull(); // redacted
    expect(parsed.runs[0]!.notes).toBeNull();       // redacted
    expect(parsed.runs[0]!.inputTokens).toBe(220);
    expect(parsed.runs[0]!.costUsd).toBeCloseTo(0.0019275, 7);
    expect(parsed.turns).toHaveLength(1);
    expect(parsed.turns[0]!.runId).toBe('run-abc');
    expect(parsed.turns[0]!.turnIdx).toBe(0);
  });

  it('header checksum matches sha256 of body', () => {
    const sql = emitSqlDump({
      tasks: [task],
      runs: [run],
      author: 'alice@example.com',
      commit: 'deadbeef',
    });
    const parsed = parseSqlDump(sql);
    expect(parsed.header.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.checksumValid).toBe(true);
  });

  it('throws on missing or malformed header', () => {
    expect(() => parseSqlDump('BEGIN TRANSACTION;\nCOMMIT;')).toThrow(/header/i);
  });
});
