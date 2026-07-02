import { describe, it, expect } from 'vitest';
import { applyMutation, assertAcyclic, MutationError } from './mutate.js';
import type { PlanDefinition } from '../types/plan.js';

const baseDef: PlanDefinition = {
  entrypoint: 'a',
  nodes: [
    { id: 'a', type: 'task', label: 'A', config: {}, edges: [{ target: 'b' }] },
    { id: 'b', type: 'task', label: 'B', config: {}, edges: [{ target: 'c' }] },
    { id: 'c', type: 'task', label: 'C', config: {}, edges: [] },
  ],
};

describe('applyMutation — addNode', () => {
  it('inserts node between anchor and its successor', () => {
    const next = applyMutation(baseDef, {
      op: 'addNode',
      after: 'a',
      node: { id: 'x', type: 'bash', label: 'X', config: { command: 'ls' }, edges: [] },
    });
    const a = next.nodes.find((n) => n.id === 'a')!;
    const x = next.nodes.find((n) => n.id === 'x')!;
    expect(a.edges).toEqual([{ target: 'x' }]);
    expect(x.edges).toEqual([{ target: 'b' }]);
    expect(next.nodes).toHaveLength(4);
  });

  it('rejects duplicate id', () => {
    expect(() =>
      applyMutation(baseDef, {
        op: 'addNode',
        after: 'a',
        node: { id: 'b', type: 'task', label: 'B2', config: {}, edges: [] },
      }),
    ).toThrow(MutationError);
  });

  it('rejects unknown anchor', () => {
    expect(() =>
      applyMutation(baseDef, {
        op: 'addNode',
        after: 'zzz',
        node: { id: 'x', type: 'task', label: 'X', config: {}, edges: [] },
      }),
    ).toThrow(/anchor/);
  });
});

describe('applyMutation — updateNode', () => {
  it('patches config', () => {
    const next = applyMutation(baseDef, {
      op: 'updateNode',
      id: 'b',
      patch: { label: 'B updated', config: { command: 'pwd' } },
    });
    const b = next.nodes.find((n) => n.id === 'b')!;
    expect(b.label).toBe('B updated');
    expect(b.config).toEqual({ command: 'pwd' });
  });

  it('does not mutate original def', () => {
    applyMutation(baseDef, {
      op: 'updateNode',
      id: 'b',
      patch: { label: 'mutated' },
    });
    const b = baseDef.nodes.find((n) => n.id === 'b')!;
    expect(b.label).toBe('B');
  });
});

describe('applyMutation — redirectEdge', () => {
  it('reroutes edge', () => {
    const next = applyMutation(baseDef, {
      op: 'redirectEdge',
      from: 'a',
      to: 'b',
      newTarget: 'c',
    });
    const a = next.nodes.find((n) => n.id === 'a')!;
    expect(a.edges[0].target).toBe('c');
  });

  it('rejects unknown new target', () => {
    expect(() =>
      applyMutation(baseDef, {
        op: 'redirectEdge',
        from: 'a',
        to: 'b',
        newTarget: 'missing',
      }),
    ).toThrow(/new target/);
  });
});

describe('applyMutation — removeNode', () => {
  it('skip mode: rewires incoming edges to successor', () => {
    const next = applyMutation(baseDef, { op: 'removeNode', id: 'b', mode: 'skip' });
    expect(next.nodes.find((n) => n.id === 'b')).toBeUndefined();
    const a = next.nodes.find((n) => n.id === 'a')!;
    expect(a.edges[0].target).toBe('c');
  });

  it('prune mode: drops edges pointing at removed node', () => {
    const next = applyMutation(baseDef, { op: 'removeNode', id: 'b', mode: 'prune' });
    const a = next.nodes.find((n) => n.id === 'a')!;
    expect(a.edges).toHaveLength(0);
  });

  it('rejects removing entrypoint', () => {
    expect(() =>
      applyMutation(baseDef, { op: 'removeNode', id: 'a', mode: 'skip' }),
    ).toThrow(/entrypoint/);
  });
});

describe('applyMutation — cycle detection', () => {
  it('rejects mutation that would create cycle', () => {
    expect(() =>
      applyMutation(baseDef, {
        op: 'redirectEdge',
        from: 'c',
        to: 'nowhere',
        newTarget: 'a',
      }),
    ).toThrow();
    // build via updateNode (bypasses redirect validation)
    expect(() =>
      applyMutation(baseDef, {
        op: 'updateNode',
        id: 'c',
        patch: { edges: [{ target: 'a' }] },
      }),
    ).toThrow(/cycle/);
  });
});

describe('assertAcyclic', () => {
  it('passes on DAG', () => {
    expect(() => assertAcyclic(baseDef)).not.toThrow();
  });

  it('throws on cycle', () => {
    const cyclic: PlanDefinition = {
      entrypoint: 'a',
      nodes: [
        { id: 'a', type: 'task', label: 'A', config: {}, edges: [{ target: 'b' }] },
        { id: 'b', type: 'task', label: 'B', config: {}, edges: [{ target: 'a' }] },
      ],
    };
    expect(() => assertAcyclic(cyclic)).toThrow(/cycle/);
  });
});
