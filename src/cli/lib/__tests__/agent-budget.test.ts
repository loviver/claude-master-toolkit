import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  DEFAULT_MAX_STEPS,
  incrementStep,
  readSteps,
  resetSteps,
  budgetStatus,
} from '../agent-budget.js';

let root: string;
const base = { sessionId: 's1', agentId: 'sdd-explore' } as const;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ctk-budget-'));
  delete process.env.CTK_AGENT_MAX_STEPS;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.CTK_AGENT_MAX_STEPS;
});

describe('agent-budget', () => {
  it('increments counter per call', () => {
    const opts = { ...base, stateRoot: root };
    expect(incrementStep(opts).steps).toBe(1);
    expect(incrementStep(opts).steps).toBe(2);
    expect(readSteps(opts)).toBe(2);
  });

  it('marks exceeded when over max', () => {
    const opts = { ...base, max: 2, stateRoot: root };
    incrementStep(opts);
    const r2 = incrementStep(opts);
    expect(r2.exceeded).toBe(false);
    const r3 = incrementStep(opts);
    expect(r3.exceeded).toBe(true);
    expect(r3.max).toBe(2);
  });

  it('env override CTK_AGENT_MAX_STEPS', () => {
    process.env.CTK_AGENT_MAX_STEPS = '3';
    const opts = { ...base, stateRoot: root };
    incrementStep(opts);
    incrementStep(opts);
    incrementStep(opts);
    expect(incrementStep(opts).exceeded).toBe(true);
  });

  it('default max is 10', () => {
    const opts = { ...base, stateRoot: root };
    expect(budgetStatus(opts).max).toBe(DEFAULT_MAX_STEPS);
  });

  it('reset clears counter', () => {
    const opts = { ...base, stateRoot: root };
    incrementStep(opts);
    resetSteps(opts);
    expect(readSteps(opts)).toBe(0);
  });

  it('isolates counters per agent', () => {
    const a = { ...base, agentId: 'a', stateRoot: root };
    const b = { ...base, agentId: 'b', stateRoot: root };
    incrementStep(a);
    incrementStep(a);
    incrementStep(b);
    expect(readSteps(a)).toBe(2);
    expect(readSteps(b)).toBe(1);
  });
});
