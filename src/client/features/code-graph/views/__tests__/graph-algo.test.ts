import { describe, expect, it } from 'vitest';
import { buildMatrix, stronglyConnected } from '../matrix-model';
import { countCrossings, layoutLayers } from '../layers-model';

const edges = (...pairs: Array<[string, string]>) => pairs.map(([source, target]) => ({ source, target, type: 'call' as const, weight: 1 }));

describe('stronglyConnected', () => {
  it('groups a cycle and leaves acyclic nodes alone', () => {
    const sccs = stronglyConnected(['a', 'b', 'c'], [['a', 'b'], ['b', 'a'], ['b', 'c']]);
    const sorted = sccs.map((c) => [...c].sort()).sort((x, y) => x[0].localeCompare(y[0]));
    expect(sorted).toEqual([['a', 'b'], ['c']]);
  });

  it('survives a very deep chain without blowing the stack', () => {
    const ids = Array.from({ length: 20000 }, (_, i) => `n${i}`);
    const es = ids.slice(1).map((id, i) => [ids[i], id] as [string, string]);
    expect(stronglyConnected(ids, es)).toHaveLength(20000);
  });
});

describe('buildMatrix', () => {
  it('orders callees first so dependencies sit below the diagonal', () => {
    const m = buildMatrix(['a', 'b', 'c'], edges(['a', 'b'], ['b', 'c']));
    expect(m.order).toEqual(['c', 'b', 'a']);
    for (const cell of m.cells) expect(cell.row).toBeGreaterThan(cell.col);
    expect(m.cells.some((c) => c.inCycle)).toBe(false);
  });

  it('marks cells inside a cycle and lists the cycle', () => {
    const m = buildMatrix(['a', 'b', 'c'], edges(['a', 'b'], ['b', 'a'], ['b', 'c']));
    expect(m.cycles).toHaveLength(1);
    expect(m.cycles[0].sort()).toEqual(['a', 'b']);
    expect(m.cells.filter((c) => c.inCycle)).toHaveLength(2);
    expect(m.cells.find((c) => !c.inCycle)).toMatchObject({ source: 'b', target: 'c' });
  });

  it('ignores links whose ends are not nodes', () => {
    expect(buildMatrix(['a'], edges(['a', 'zzz'])).cells).toEqual([]);
  });
});

describe('layoutLayers', () => {
  it('puts callers above what they call (longest path)', () => {
    const l = layoutLayers(['a', 'b', 'c'], edges(['a', 'b'], ['b', 'c'], ['a', 'c']));
    expect(l.layerOf.get('a')).toBe(0);
    expect(l.layerOf.get('b')).toBe(1);
    expect(l.layerOf.get('c')).toBe(2);
  });

  it('a cycle shares one layer and its edges are flagged', () => {
    const l = layoutLayers(['a', 'b', 'c'], edges(['a', 'b'], ['b', 'a'], ['b', 'c']));
    expect(l.layerOf.get('a')).toBe(l.layerOf.get('b'));
    expect(l.layerOf.get('c')).toBe(l.layerOf.get('a')! + 1);
    expect(l.cyclic.size).toBe(2);
  });

  it('barycenter sweeps remove avoidable crossings', () => {
    // a→y and b→x with the lower layer listed x,y would cross.
    const es = edges(['a', 'y'], ['b', 'x']);
    const l = layoutLayers(['a', 'b', 'x', 'y'], es);
    expect(countCrossings(l.layers, es)).toBe(0);
  });

  it('every node lands in exactly one layer', () => {
    const l = layoutLayers(['a', 'b', 'c', 'd'], edges(['a', 'b']));
    expect(l.layers.flat().sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
