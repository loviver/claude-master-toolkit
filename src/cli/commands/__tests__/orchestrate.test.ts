import { describe, it, expect } from 'vitest';
import { buildOrchestrationPlan } from '../orchestrate.js';

describe('buildOrchestrationPlan', () => {
  it('returns ordered component steps for a selection', () => {
    const p = buildOrchestrationPlan('skills');
    expect(p.steps.map((s) => s.id)).toEqual(['pandorica', 'sdd', 'skills']);
  });

  it('expands "all" selection', () => {
    const p = buildOrchestrationPlan('all');
    expect(p.steps.length).toBeGreaterThanOrEqual(6);
  });

  it('throws on unknown component', () => {
    expect(() => buildOrchestrationPlan('ghost')).toThrow(/unknown/i);
  });
});
