import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { parseJsonlForBench } from '../ingest.js';

const FIXTURE = join(__dirname, 'fixtures', 'sonnet-two-turns.jsonl');

describe('parseJsonlForBench', () => {
  it('aggregates tokens and cost from jsonl into a BenchRun', async () => {
    const run = await parseJsonlForBench(FIXTURE, {
      taskId: 't1',
      variant: 'ctk',
      author: 'alice@example.com',
      commit: 'deadbeef',
    });

    expect(run.taskId).toBe('t1');
    expect(run.variant).toBe('ctk');
    expect(run.sessionId).toBe('sess1');
    expect(run.model).toBe('claude-sonnet-4-6');
    expect(run.turnCount).toBe(2);
    expect(run.inputTokens).toBe(220);
    expect(run.outputTokens).toBe(50);
    expect(run.cacheRead).toBe(1100);
    expect(run.cacheCreation).toBe(50);
    expect(run.stopReason).toBe('end_turn');
    expect(run.startedAt).toBe(Date.parse('2026-04-17T10:00:00.000Z'));
    expect(run.endedAt).toBe(Date.parse('2026-04-17T10:00:20.000Z'));
    expect(run.wallMs).toBe(20000);
    expect(JSON.parse(run.toolCallsJson)).toEqual(['Read']);
    expect(run.sourceJsonl).toBe(FIXTURE);
    expect(run.provenanceAuthor).toBe('alice@example.com');
    expect(run.provenanceCommit).toBe('deadbeef');
    expect(run.importedFrom).toBeNull();

    // checksum is sha256 hex
    expect(run.checksum).toMatch(/^[0-9a-f]{64}$/);

    // cost snapshot: sum of per-turn computeCost under sonnet pricing
    // turn1: (100*3 + 20*15 + 500*0.3)/1e6 = 750/1e6 = 0.00075
    // turn2: (120*3 + 30*15 + 600*0.3 + 50*3.75)/1e6 = 1177.5/1e6 = 0.0011775
    expect(run.costUsd).toBeCloseTo(0.0019275, 7);

    expect(run.turns.length).toBe(2);
    expect(run.turns[0]!.turnIdx).toBe(0);
    expect(run.turns[0]!.inputTokens).toBe(100);
    expect(run.turns[0]!.costUsd).toBeCloseTo(0.00075, 7);
    expect(run.turns[0]!.stopReason).toBe('tool_use');
    expect(JSON.parse(run.turns[0]!.toolsJson)).toEqual(['Read']);

    expect(run.turns[1]!.turnIdx).toBe(1);
    expect(run.turns[1]!.stopReason).toBe('end_turn');
  });

  it('honors optional notes, success, and model override', async () => {
    const run = await parseJsonlForBench(FIXTURE, {
      taskId: 't1',
      variant: 'baseline',
      notes: 'run #3',
      success: 1,
    });

    expect(run.variant).toBe('baseline');
    expect(run.notes).toBe('run #3');
    expect(run.success).toBe(1);
  });

  it('produces same checksum for identical file content (idempotent)', async () => {
    const a = await parseJsonlForBench(FIXTURE, { taskId: 't1', variant: 'ctk' });
    const b = await parseJsonlForBench(FIXTURE, { taskId: 't1', variant: 'ctk' });
    expect(a.checksum).toBe(b.checksum);
  });
});
