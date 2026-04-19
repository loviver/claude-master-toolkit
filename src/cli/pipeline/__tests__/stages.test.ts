import { describe, it, expect, vi } from 'vitest';
import { runPipeline } from '../stages.js';
import type { Step, RollbackStep, ProgressEvent } from '../stages.js';

function step(id: string, run: () => Promise<void> = async () => {}): Step {
  return { id: () => id, run };
}

function rollbackStep(id: string, run: () => Promise<void>, rollback: () => Promise<void>): RollbackStep {
  return { id: () => id, run, rollback };
}

describe('runPipeline', () => {
  it('runs prepare steps then apply steps in order', async () => {
    const calls: string[] = [];
    const r = await runPipeline({
      prepare: [
        step('p1', async () => { calls.push('p1'); }),
        step('p2', async () => { calls.push('p2'); }),
      ],
      apply: [
        step('a1', async () => { calls.push('a1'); }),
        step('a2', async () => { calls.push('a2'); }),
      ],
    });
    expect(calls).toEqual(['p1', 'p2', 'a1', 'a2']);
    expect(r.status).toBe('ok');
  });

  it('aborts when a prepare step fails, does not run apply', async () => {
    const calls: string[] = [];
    const r = await runPipeline({
      prepare: [
        step('p1', async () => { calls.push('p1'); throw new Error('boom'); }),
      ],
      apply: [step('a1', async () => { calls.push('a1'); })],
    });
    expect(calls).toEqual(['p1']);
    expect(r.status).toBe('failed');
    expect(r.failedStep).toBe('p1');
  });

  it('rolls back completed apply steps in reverse order when apply step fails', async () => {
    const calls: string[] = [];
    const r = await runPipeline({
      prepare: [],
      apply: [
        rollbackStep('a1', async () => { calls.push('a1'); }, async () => { calls.push('r1'); }),
        rollbackStep('a2', async () => { calls.push('a2'); }, async () => { calls.push('r2'); }),
        step('a3', async () => { calls.push('a3'); throw new Error('fail'); }),
      ],
    });
    expect(calls).toEqual(['a1', 'a2', 'a3', 'r2', 'r1']);
    expect(r.status).toBe('failed');
    expect(r.failedStep).toBe('a3');
    expect(r.rolledBack).toEqual(['a2', 'a1']);
  });

  it('emits progress events for running/ok/failed transitions', async () => {
    const events: ProgressEvent[] = [];
    await runPipeline({
      prepare: [step('p1')],
      apply: [step('a1', async () => { throw new Error('x'); })],
      onProgress: (e) => events.push(e),
    });
    const p1Events = events.filter((e) => e.stepId === 'p1');
    expect(p1Events.map((e) => e.status)).toEqual(['running', 'ok']);
    const a1Events = events.filter((e) => e.stepId === 'a1');
    expect(a1Events.map((e) => e.status)).toEqual(['running', 'failed']);
  });

  it('skips rollback for steps without rollback method', async () => {
    const rollback = vi.fn();
    await runPipeline({
      prepare: [],
      apply: [
        step('a1'),
        rollbackStep('a2', async () => {}, rollback),
        step('a3', async () => { throw new Error('fail'); }),
      ],
    });
    expect(rollback).toHaveBeenCalledOnce();
  });
});
