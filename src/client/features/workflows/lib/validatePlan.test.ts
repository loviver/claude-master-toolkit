import { describe, it, expect } from 'vitest';
import { validatePlan } from './validatePlan.js';
import type { PlanDefinition } from '../../../../shared/types/plan.js';

const node = (id: string, edges: Array<{ target: string }> = []): any => ({
  id,
  type: 'task',
  label: id,
  config: {},
  edges,
});

describe('validatePlan', () => {
  it('passes on a valid linear plan', () => {
    const def: PlanDefinition = {
      entrypoint: 'a',
      nodes: [node('a', [{ target: 'b' }]), node('b')],
    };
    expect(validatePlan(def)).toEqual({ ok: true, errors: [] });
  });

  it('fails when entrypoint missing from nodes', () => {
    const def: PlanDefinition = { entrypoint: 'zzz', nodes: [node('a')] };
    const r = validatePlan(def);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('entrypoint'))).toBe(true);
  });

  it('fails when edge target does not exist', () => {
    const def: PlanDefinition = {
      entrypoint: 'a',
      nodes: [node('a', [{ target: 'ghost' }])],
    };
    const r = validatePlan(def);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('ghost'))).toBe(true);
  });

  it('fails on cycle', () => {
    const def: PlanDefinition = {
      entrypoint: 'a',
      nodes: [
        node('a', [{ target: 'b' }]),
        node('b', [{ target: 'a' }]),
      ],
    };
    const r = validatePlan(def);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.toLowerCase().includes('cycle'))).toBe(true);
  });

  it('fails on empty nodes', () => {
    const def: PlanDefinition = { entrypoint: 'a', nodes: [] };
    expect(validatePlan(def).ok).toBe(false);
  });

  it('fails on duplicate node ids', () => {
    const def: PlanDefinition = {
      entrypoint: 'a',
      nodes: [node('a'), node('a')],
    };
    const r = validatePlan(def);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.toLowerCase().includes('duplicate'))).toBe(true);
  });
});
