import { describe, it, expect } from 'vitest';
import { Graph, Resolver } from '../graph.js';

describe('Graph', () => {
  it('stores hard dependencies', () => {
    const g = new Graph();
    g.add('a', []);
    g.add('b', ['a']);
    expect(g.deps('b')).toEqual(['a']);
    expect(g.deps('a')).toEqual([]);
  });

  it('returns empty deps for unknown component', () => {
    expect(new Graph().deps('nope')).toEqual([]);
  });
});

describe('Resolver.resolve', () => {
  const ctkGraph = (): Graph => {
    const g = new Graph();
    g.add('pandorica', []);
    g.add('sdd', ['pandorica']);
    g.add('skills', ['sdd']);
    g.add('persona', []);
    g.add('hooks', ['pandorica']);
    return g;
  };

  it('returns ordered components for single selection (topological)', () => {
    const r = new Resolver(ctkGraph()).resolve(['skills']);
    expect(r.orderedComponents).toEqual(['pandorica', 'sdd', 'skills']);
    expect(r.addedDependencies.sort()).toEqual(['pandorica', 'sdd']);
  });

  it('includes already-selected components in order but not in addedDependencies', () => {
    const r = new Resolver(ctkGraph()).resolve(['pandorica', 'sdd']);
    expect(r.orderedComponents).toEqual(['pandorica', 'sdd']);
    expect(r.addedDependencies).toEqual([]);
  });

  it('resolves multiple selections with shared deps', () => {
    const r = new Resolver(ctkGraph()).resolve(['skills', 'hooks']);
    // pandorica appears once, before both sdd and hooks
    expect(r.orderedComponents.indexOf('pandorica')).toBeLessThan(r.orderedComponents.indexOf('sdd'));
    expect(r.orderedComponents.indexOf('pandorica')).toBeLessThan(r.orderedComponents.indexOf('hooks'));
    expect(r.orderedComponents.indexOf('sdd')).toBeLessThan(r.orderedComponents.indexOf('skills'));
    expect(r.orderedComponents.filter((c) => c === 'pandorica')).toHaveLength(1);
  });

  it('applies soft-ordering pairs when both selected', () => {
    const g = new Graph();
    g.add('pandorica', []);
    g.add('persona', []);
    g.addSoftOrder('persona', 'pandorica');
    const r = new Resolver(g).resolve(['persona', 'pandorica']);
    expect(r.orderedComponents.indexOf('persona')).toBeLessThan(r.orderedComponents.indexOf('pandorica'));
  });

  it('ignores soft-ordering when only one side selected', () => {
    const g = new Graph();
    g.add('pandorica', []);
    g.add('persona', []);
    g.addSoftOrder('persona', 'pandorica');
    const r = new Resolver(g).resolve(['pandorica']);
    expect(r.orderedComponents).toEqual(['pandorica']);
  });

  it('detects circular dependencies', () => {
    const g = new Graph();
    g.add('a', ['b']);
    g.add('b', ['a']);
    expect(() => new Resolver(g).resolve(['a'])).toThrow(/cycle/i);
  });

  it('rejects unknown component', () => {
    expect(() => new Resolver(ctkGraph()).resolve(['ghost'])).toThrow(/unknown/i);
  });
});
