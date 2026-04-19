import { describe, it, expect } from 'vitest';
import { planSelection } from '../plan.js';

describe('planSelection', () => {
  it('resolves comma-separated selection into topological order', () => {
    const r = planSelection('skills');
    expect(r.orderedComponents).toEqual(['pandorica', 'sdd', 'skills']);
    expect(r.addedDependencies.sort()).toEqual(['pandorica', 'sdd']);
  });

  it('expands "all" to every ctk component', () => {
    const r = planSelection('all');
    expect(r.orderedComponents.length).toBeGreaterThanOrEqual(6);
    expect(r.orderedComponents).toContain('pandorica');
    expect(r.orderedComponents).toContain('hooks');
  });

  it('rejects unknown components with a clear error', () => {
    expect(() => planSelection('ghost,pandorica')).toThrow(/unknown/i);
  });

  it('accepts multiple components', () => {
    const r = planSelection('hooks,persona');
    expect(r.orderedComponents).toEqual(expect.arrayContaining(['pandorica', 'hooks', 'persona']));
  });
});
