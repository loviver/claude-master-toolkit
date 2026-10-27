import { describe, it, expect } from 'vitest';
import type { CodeGraphNodeDTO } from '../../../lib/types';
import { DIFF_FOCUS } from '../../../../shared/api-types';
import { buildAdjacency } from '../graph-model';
import type { RenderNode } from '../graph-model';
import { anchorForce, focusSeeds, hopDistance, radialLayout, ringLabel, ringRadii } from '../impact-layout';

function node(id: string, over: Partial<CodeGraphNodeDTO> = {}): CodeGraphNodeDTO {
  return {
    id, label: id, kind: 'function', file: 'src/a.ts', group: 'src',
    rank: 0.5, size: 1, exported: true, signature: null, startLine: 1, endLine: 2, indexedAt: 100,
    loc: 2, callers: 0, churn: 0, ...over,
  };
}

/** `[caller, callee]` pairs. */
const adj = (pairs: [string, string][]) =>
  buildAdjacency(pairs.map(([source, target]) => ({ source, target, type: 'call' as const, weight: 1 })));

const angle = (p: { x: number; y: number }) => Math.atan2(p.y, p.x);
const angularGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};

describe('focusSeeds', () => {
  const nodes = [
    node('src/a.ts::f', { file: 'src/a.ts' }),
    node('src/lib/b.ts::g', { file: 'src/lib/b.ts' }),
    node('src/lib/c.ts::h', { file: 'src/lib/c.ts' }),
    node('src/lib2/d.ts::k', { file: 'src/lib2/d.ts' }),
  ];

  it('seeds the focused node itself when the focus is a node id', () => {
    expect(focusSeeds(nodes, 'src/a.ts::f', [])).toEqual(new Set(['src/a.ts::f']));
  });

  it('seeds every node under a folder focus, not its prefix siblings', () => {
    expect(focusSeeds(nodes, 'src/lib/', [])).toEqual(new Set(['src/lib/b.ts::g', 'src/lib/c.ts::h']));
  });

  it('seeds a file-level node by its id (file is null for modules)', () => {
    const mods = [node('src/lib', { file: null }), node('src/other', { file: null })];
    expect(focusSeeds(mods, 'src', [])).toEqual(new Set(['src/lib', 'src/other']));
  });

  it('seeds the drawn changed nodes for the diff focus', () => {
    expect(focusSeeds(nodes, DIFF_FOCUS, ['src/a.ts::f', 'gone'])).toEqual(new Set(['src/a.ts::f']));
  });
});

describe('hopDistance', () => {
  const a = adj([['b', 'a'], ['c', 'b'], ['a', 'dep'], ['dep', 'deeper']]);

  it('walks callers from the seeds: seeds at 0, nearest hop wins', () => {
    expect(hopDistance(a, ['a'], 'callers')).toEqual(new Map([['a', 0], ['b', 1], ['c', 2]]));
  });

  it('walks deps for the deps direction', () => {
    expect(hopDistance(a, ['a'], 'deps')).toEqual(new Map([['a', 0], ['dep', 1], ['deeper', 2]]));
  });

  it('walks both ways for both', () => {
    expect(hopDistance(a, ['a'], 'both')).toEqual(
      new Map([['a', 0], ['b', 1], ['dep', 1], ['c', 2], ['deeper', 2]]),
    );
  });

  it('keeps a node reachable from two seeds at its nearest distance', () => {
    const d = hopDistance(adj([['x', 's1'], ['y', 'x'], ['y', 's2']]), ['s1', 's2'], 'callers');
    expect(d.get('y')).toBe(1);
  });
});

describe('radialLayout', () => {
  const radius = () => 2;
  const opts = { ringGap: 40, padding: 4 };

  it('puts a single seed at the centre and each hop on its own, wider ring', () => {
    const a = adj([['b1', 's'], ['b2', 's'], ['c1', 'b1']]);
    const hops = hopDistance(a, ['s'], 'callers');
    const pos = radialLayout(['s', 'b1', 'b2', 'c1'], hops, a, radius, opts);
    expect(pos.get('s')).toEqual({ x: 0, y: 0 });
    const r = (id: string) => Math.hypot(pos.get(id)!.x, pos.get(id)!.y);
    expect(r('b1')).toBeCloseTo(r('b2'));
    expect(r('b1')).toBeGreaterThanOrEqual(opts.ringGap);
    expect(r('c1')).toBeGreaterThanOrEqual(r('b1') + opts.ringGap);
  });

  it('parks nodes the walk did not reach on a ring beyond the last hop', () => {
    const a = adj([['b', 's']]);
    const pos = radialLayout(['s', 'b', 'stray'], hopDistance(a, ['s'], 'callers'), a, radius, opts);
    const r = (id: string) => Math.hypot(pos.get(id)!.x, pos.get(id)!.y);
    expect(r('stray')).toBeGreaterThan(r('b'));
  });

  it('grows a crowded ring until no two nodes on it overlap', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `n${i}`);
    const a = adj(ids.map((id) => [id, 's'] as [string, string]));
    const pos = radialLayout(['s', ...ids], hopDistance(a, ['s'], 'callers'), a, () => 5, opts);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const p = pos.get(ids[i])!, q = pos.get(ids[j])!;
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('spreads several seeds on a small inner ring instead of stacking them', () => {
    const pos = radialLayout(['s1', 's2', 's3'], new Map([['s1', 0], ['s2', 0], ['s3', 0]]), adj([]), radius, opts);
    const pts = [...pos.values()];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('places each node near the parent it hangs from, so subtrees do not cross', () => {
    const a = adj([['p', 's'], ['q', 's'], ['p1', 'p'], ['p2', 'p'], ['q1', 'q'], ['q2', 'q']]);
    const pos = radialLayout(['s', 'p', 'q', 'q1', 'p1', 'q2', 'p2'], hopDistance(a, ['s'], 'callers'), a, radius, opts);
    const at = (id: string) => angle(pos.get(id)!);
    for (const child of ['p1', 'p2']) expect(angularGap(at(child), at('p'))).toBeLessThan(angularGap(at(child), at('q')));
    for (const child of ['q1', 'q2']) expect(angularGap(at(child), at('q'))).toBeLessThan(angularGap(at(child), at('p')));
  });

  it('is deterministic whatever the input order', () => {
    const a = adj([['b1', 's'], ['b2', 's'], ['c1', 'b2']]);
    const hops = hopDistance(a, ['s'], 'callers');
    const one = radialLayout(['s', 'b1', 'b2', 'c1'], hops, a, radius, opts);
    const two = radialLayout(['c1', 'b2', 'b1', 's'], hops, a, radius, opts);
    for (const [id, p] of one) expect(two.get(id)).toEqual(p);
  });
});

describe('anchorForce', () => {
  const at = (id: string, x: number, y: number, z: number): RenderNode => ({ ...node(id), x, y, z, vx: 0, vy: 0, vz: 0 });

  it('pulls each node toward its target on the plane z = 0, scaled by alpha', () => {
    const nodes = [at('a', 10, 0, 4)];
    const force = anchorForce(new Map([['a', { x: 0, y: 2 }]]), 0.5);
    force.initialize(nodes);
    force(0.5);
    expect(nodes[0].vx).toBeCloseTo(-2.5);
    expect(nodes[0].vy).toBeCloseTo(0.5);
    expect(nodes[0].vz).toBeCloseTo(-1);
  });

  it('leaves nodes without a target alone', () => {
    const nodes = [at('b', 10, 0, 4)];
    const force = anchorForce(new Map(), 0.5);
    force.initialize(nodes);
    force(1);
    expect(nodes[0]).toMatchObject({ vx: 0, vy: 0, vz: 0 });
  });
});

describe('ringRadii', () => {
  const opts = { ringGap: 40, padding: 4 };
  const a = adj([['b1', 's'], ['b2', 's'], ['c1', 'b1']]);
  const hops = hopDistance(a, ['s'], 'callers');
  const ids = ['s', 'b1', 'b2', 'c1', 'stray'];
  const pos = radialLayout(ids, hops, a, () => 2, opts);

  it('gives one radius per ring, innermost first, skipping a lone seed at the centre', () => {
    const rings = ringRadii(ids, hops, pos);
    expect(rings.map((r) => r.hop)).toEqual([1, 2, null]);
    expect(rings[0].radius).toBeCloseTo(Math.hypot(pos.get('b1')!.x, pos.get('b1')!.y));
    expect(rings[1].radius).toBeGreaterThan(rings[0].radius);
    expect(rings[2].radius).toBeGreaterThan(rings[1].radius);
  });

  it('keeps a seed ring when several seeds spread around the centre', () => {
    const seeds = new Map([['s1', 0], ['s2', 0]]);
    const p = radialLayout(['s1', 's2'], seeds, adj([]), () => 2, opts);
    expect(ringRadii(['s1', 's2'], seeds, p).map((r) => r.hop)).toEqual([0]);
  });
});

describe('ringLabel', () => {
  it('names a ring by its hop count, the stray ring as unreached', () => {
    expect(ringLabel(0)).toBe('focus');
    expect(ringLabel(1)).toBe('1 hop');
    expect(ringLabel(3)).toBe('3 hops');
    expect(ringLabel(null)).toBe('unreached');
  });
});
