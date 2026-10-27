import { describe, it, expect } from 'vitest';
import type { CodeGraphDTO, CodeGraphNodeDTO, CodeGraphProjectDTO } from '../../../lib/types';
import {
  buildAdjacency,
  impactColor,
  impactDistance,
  reviewColor,
  IMPACT_COLORS,
  STATE_COLORS,
  clusterForce,
  clusterKey,
  collideForce,
  labelTop,
  tooltipBox,
  nodeRadius3D,
  filterGraph,
  neighbourAt,
  parseHidden,
  pathLinkKeys,
  reviewSpotlight,
  serializeHidden,
  shortestPath,
  colorScale,
  HEAT_COLORS,
  heatColor,
  metricScale,
  nodeVal,
  parseColorMode,
  parseSizeMetric,
  forceTuning,
  linkWidth3D,
  pinNode,
  unpinNode,
  defaultLevel,
  drillTarget,
  escapeHtml,
  kindCategory,
  labelCandidates,
  linkEnds,
  mergeGraph,
  neighbourhood,
  parseDirection,
  placeLabels,
  searchNodes,
  strongerLink,
  zoneCentroids,
  zonePalette,
  ZONE_COLORS,
  ZONE_OTHER,
  type RenderNode,
} from '../graph-model';

function node(id: string, over: Partial<CodeGraphNodeDTO> = {}): CodeGraphNodeDTO {
  return {
    id, label: id.split('::').pop()!.split('/').pop()!, kind: 'function', file: 'src/a.ts', group: 'src',
    rank: 0.5, size: 1, exported: true, signature: null, startLine: 1, endLine: 2, indexedAt: 100,
    loc: 2, callers: 0, churn: 0, ...over,
  };
}

function dto(nodes: CodeGraphNodeDTO[], links: CodeGraphDTO['links'] = [], revision = 'r1'): CodeGraphDTO {
  return {
    project: '/p', level: 'symbol', revision, nodes, links,
    stats: { totalNodes: nodes.length, totalLinks: links.length, unresolved: 0, truncated: false },
  };
}

describe('mergeGraph', () => {
  it('keeps the layout position of nodes that survive a refresh', () => {
    const first = mergeGraph(null, dto([node('a'), node('b')]));
    Object.assign(first.nodes[0], { x: 10, y: 20, z: 30, vx: 1, vy: 2, vz: 3 });
    const second = mergeGraph(first, dto([node('a'), node('c')], [], 'r2'));
    const a = second.nodes.find((n) => n.id === 'a')!;
    expect(a).toMatchObject({ x: 10, y: 20, z: 30, vx: 1, vy: 2, vz: 3 });
    expect(second.nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
  });

  it('reports new and reindexed nodes as changed, but nothing on the first load', () => {
    const first = mergeGraph(null, dto([node('a'), node('b')]));
    expect(first.changed).toEqual([]);
    const second = mergeGraph(first, dto([node('a', { indexedAt: 500 }), node('b'), node('c')], [], 'r2'));
    expect(second.changed.sort()).toEqual(['a', 'c']);
  });

  it('hands the renderer fresh link objects keyed by id', () => {
    const g = mergeGraph(null, dto([node('a'), node('b')], [{ source: 'a', target: 'b', type: 'call', weight: 2 }]));
    expect(g.links).toEqual([{ source: 'a', target: 'b', type: 'call', weight: 2 }]);
  });
});

describe('linkEnds', () => {
  it('reads ids whether the renderer already swapped them for node objects or not', () => {
    expect(linkEnds({ source: 'a', target: 'b', type: 'call', weight: 1 })).toEqual(['a', 'b']);
    expect(linkEnds({ source: node('a'), target: node('b'), type: 'call', weight: 1 })).toEqual(['a', 'b']);
  });
});

describe('buildAdjacency', () => {
  it('indexes incoming callers and outgoing deps per node', () => {
    const adj = buildAdjacency([
      { source: 'a', target: 'core', type: 'call', weight: 1 },
      { source: 'b', target: 'core', type: 'ref', weight: 1 },
      { source: 'core', target: 'util', type: 'call', weight: 1 },
    ]);
    expect([...adj.get('core')!.callers].sort()).toEqual(['a', 'b']);
    expect([...adj.get('core')!.deps]).toEqual(['util']);
    expect(adj.get('util')!.deps.size).toBe(0);
  });
});

describe('neighbourhood', () => {
  const adj = buildAdjacency([
    { source: 'a', target: 'core', type: 'call', weight: 1 },
    { source: 'core', target: 'util', type: 'call', weight: 1 },
    { source: 'util', target: 'far', type: 'call', weight: 1 },
  ]);

  it('is the node plus its direct callers and deps', () => {
    expect([...neighbourhood('core', adj)].sort()).toEqual(['a', 'core', 'util']);
  });

  it('is just the node when it has no edges', () => {
    expect([...neighbourhood('alone', adj)]).toEqual(['alone']);
  });
});

describe('labelCandidates', () => {
  const nodes = [
    node('low', { rank: 0.1 }),
    node('mid', { rank: 0.5 }),
    node('top', { rank: 1 }),
    node('sel', { rank: 0.05 }),
  ];
  const adj = buildAdjacency([
    { source: 'low', target: 'sel', type: 'call', weight: 1 },
    { source: 'sel', target: 'mid', type: 'call', weight: 1 },
  ]);

  it('without a selection offers the most central nodes first, capped', () => {
    expect(labelCandidates(nodes, null, adj, 2).map((n) => n.id)).toEqual(['top', 'mid']);
  });

  it('with a selection offers the selection first, then only its neighbours by rank', () => {
    expect(labelCandidates(nodes, 'sel', adj, 10).map((n) => n.id)).toEqual(['sel', 'mid', 'low']);
  });

  it('pinned nodes (the open file) are always offered, right after the selection', () => {
    expect(labelCandidates(nodes, null, adj, 2, new Set(['low'])).map((n) => n.id)).toEqual(['low', 'top']);
    expect(labelCandidates(nodes, 'sel', adj, 10, new Set(['top'])).map((n) => n.id)).toEqual(['sel', 'top', 'mid', 'low']);
  });
});

describe('zoneCentroids', () => {
  it('averages laid-out positions per group, biggest zone first, skipping unplaced nodes', () => {
    const nodes: RenderNode[] = [
      { ...node('a', { group: 'src/auth' }), x: 0, y: 0, z: 0 },
      { ...node('b', { group: 'src/auth' }), x: 10, y: 20, z: 30 },
      { ...node('c', { group: 'src/bank' }), x: 5, y: 5, z: 5 },
      node('d', { group: 'src/bank' }),
    ];
    expect(zoneCentroids(nodes)).toEqual([
      { group: 'src/auth', count: 2, x: 5, y: 10, z: 15 },
      { group: 'src/bank', count: 1, x: 5, y: 5, z: 5 },
    ]);
  });
});

describe('placeLabels', () => {
  it('keeps labels in priority order and drops any that would overlap a placed one', () => {
    const placed = placeLabels([
      { id: 'first', x: 0, y: 0, w: 50, h: 10 },
      { id: 'overlaps', x: 40, y: 5, w: 50, h: 10 },
      { id: 'clear', x: 0, y: 20, w: 50, h: 10 },
    ]);
    expect([...placed]).toEqual(['first', 'clear']);
  });
});

describe('clusterForce', () => {
  it('nudges each node toward the centre of its own zone, scaled by alpha', () => {
    const nodes: RenderNode[] = [
      { ...node('a', { group: 'g1' }), x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      { ...node('b', { group: 'g1' }), x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      { ...node('c', { group: 'g2' }), x: 100, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    ];
    const force = clusterForce(0.5);
    force.initialize(nodes);
    force(1);
    expect(nodes[0].vx).toBeCloseTo(2.5);
    expect(nodes[1].vx).toBeCloseTo(-2.5);
    expect(nodes[2].vx).toBe(0);
  });
});

describe('searchNodes', () => {
  const nodes = [
    node('src/a.ts::useAuth', { rank: 0.2 }),
    node('src/b.ts::authorize', { rank: 0.9 }),
    node('src/c.ts::other', { rank: 1 }),
  ];

  it('matches label or id case-insensitively, best rank first, prefix matches before infix', () => {
    expect(searchNodes(nodes, 'AUTH').map((n) => n.label)).toEqual(['authorize', 'useAuth']);
    expect(searchNodes(nodes, 'c.ts').map((n) => n.label)).toEqual(['other']);
  });

  it('returns nothing for a blank query and honours the cap', () => {
    expect(searchNodes(nodes, '  ')).toEqual([]);
    expect(searchNodes(nodes, 'src', 2)).toHaveLength(2);
  });
});

describe('strongerLink', () => {
  it('keeps the type that says most about runtime flow when several fold into one edge', () => {
    expect(strongerLink('ref', 'call')).toBe('call');
    expect(strongerLink('call', 'dispatch')).toBe('dispatch');
    expect(strongerLink('inherit', 'ref')).toBe('inherit');
    expect(strongerLink('call', 'inherit')).toBe('call');
  });
});

describe('parseDirection', () => {
  it('defaults to callers: an impact view answers "what would this break"', () => {
    expect(parseDirection(null)).toBe('callers');
    expect(parseDirection('sideways')).toBe('callers');
  });

  it('keeps a known direction', () => {
    expect(parseDirection('deps')).toBe('deps');
    expect(parseDirection('both')).toBe('both');
  });
});

describe('drillTarget', () => {
  it('opens the next level scoped to the clicked node', () => {
    expect(drillTarget(node('src/shared', { kind: 'module', file: null }), 'module')).toEqual({ level: 'file', scope: 'src/shared' });
    expect(drillTarget(node('src/a.ts', { kind: 'file', file: 'src/a.ts' }), 'file')).toEqual({ level: 'symbol', scope: 'src/a.ts' });
    expect(drillTarget(node('src/a.ts::x'), 'symbol')).toBeNull();
  });

  it('drilling into the repo root module clears the scope', () => {
    expect(drillTarget(node('.', { kind: 'module', file: null }), 'module')).toEqual({ level: 'file', scope: undefined });
  });
});

describe('defaultLevel', () => {
  const project = (symbols: number, files: number): CodeGraphProjectDTO => ({ projectPath: '/p', symbols, files, indexedAt: 0 });

  it('picks the finest level that stays renderable', () => {
    expect(defaultLevel(project(1600, 350))).toBe('symbol');
    expect(defaultLevel(project(6600, 1500))).toBe('file');
    expect(defaultLevel(project(12800, 2960))).toBe('module');
  });
});

describe('kindCategory', () => {
  it('folds symbol kinds into the legend categories', () => {
    expect(kindCategory('function')).toBe('callable');
    expect(kindCategory('method')).toBe('callable');
    expect(kindCategory('class')).toBe('class');
    expect(kindCategory('interface')).toBe('type');
    expect(kindCategory('enum')).toBe('type');
    expect(kindCategory('const')).toBe('value');
    expect(kindCategory('module')).toBe('module');
    expect(kindCategory('file')).toBe('file');
    expect(kindCategory('whatever')).toBe('value');
  });
});

describe('escapeHtml', () => {
  it('neutralizes markup coming from file and symbol names', () => {
    expect(escapeHtml(`<img src=x onerror="a()">&'`)).toBe('&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
  });
});

describe('zonePalette', () => {
  it('gives the biggest zones the palette in order and the long tail one shared color', () => {
    const nodes = [
      ...Array.from({ length: 3 }, (_, i) => node(`b${i}`, { group: 'src/b' })),
      ...Array.from({ length: 5 }, (_, i) => node(`a${i}`, { group: 'src/a' })),
      ...ZONE_COLORS.map((_, i) => node(`t${i}`, { group: `tail/${i}` })),
    ];
    const palette = zonePalette(nodes);
    expect(palette.get('src/a')).toBe(ZONE_COLORS[0]);
    expect(palette.get('src/b')).toBe(ZONE_COLORS[1]);
    expect(palette.get(`tail/${ZONE_COLORS.length - 1}`)).toBe(ZONE_OTHER);
  });
});

describe('clusterKey', () => {
  it('groups by the first `depth` folders of the node file', () => {
    expect(clusterKey(node('a', { file: 'src/client/features/x/a.ts' }), 3)).toBe('src/client/features');
    expect(clusterKey(node('a', { file: 'src/client/a.ts' }), 3)).toBe('src/client');
  });

  it('falls back to the server group when the node has no file', () => {
    expect(clusterKey(node('m', { file: null as unknown as string, group: 'pkg' }), 3)).toBe('pkg');
  });

  it('puts root files in the root cluster', () => {
    expect(clusterKey(node('a', { file: 'a.ts' }), 3)).toBe('.');
  });
});

describe('clusterForce key', () => {
  it('clusters by the given key instead of the server group', () => {
    const nodes: RenderNode[] = [
      { ...node('a', { group: 'g' }), x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      { ...node('b', { group: 'g' }), x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    ];
    const force = clusterForce(0.5, (n) => n.id);
    force.initialize(nodes);
    force(1);
    expect(nodes[0].vx).toBe(0);
    expect(nodes[1].vx).toBe(0);
  });
});

describe('forceTuning', () => {
  it('weakens repulsion as the graph grows so big graphs stay compact', () => {
    expect(forceTuning(50).charge).toBeLessThan(forceTuning(2000).charge);
    expect(forceTuning(2000).charge).toBeLessThan(0);
  });

  it('keeps inheritance tight and loose references long', () => {
    const { linkDistance } = forceTuning(100);
    expect(linkDistance.inherit).toBeLessThan(linkDistance.call);
    expect(linkDistance.call).toBeLessThan(linkDistance.ref);
  });

  it('skips warm-up on big graphs so the first frame is not delayed', () => {
    expect(forceTuning(100).warmupTicks).toBeGreaterThan(0);
    expect(forceTuning(5000).warmupTicks).toBe(0);
  });
});

describe('linkWidth3D', () => {
  it('grows with weight, logarithmically', () => {
    expect(linkWidth3D(1)).toBeGreaterThan(0);
    expect(linkWidth3D(8)).toBeGreaterThan(linkWidth3D(1));
    expect(linkWidth3D(64) - linkWidth3D(8)).toBeLessThan(linkWidth3D(8) * 2);
  });
});

describe('pinNode / unpinNode', () => {
  it('fixes a node where it was dropped and releases it again', () => {
    const n: RenderNode = { ...node('a'), x: 1, y: 2, z: 3 };
    pinNode(n);
    expect([n.fx, n.fy, n.fz]).toEqual([1, 2, 3]);
    unpinNode(n);
    expect([n.fx, n.fy, n.fz]).toEqual([undefined, undefined, undefined]);
  });
});

describe('metricScale', () => {
  it('maps a metric to 0..1 against the biggest node, sqrt so the tail stays visible', () => {
    const nodes = [node('a', { churn: 0 }), node('b', { churn: 25 }), node('c', { churn: 100 })];
    const t = metricScale(nodes, 'churn');
    expect(t(nodes[0])).toBe(0);
    expect(t(nodes[1])).toBeCloseTo(0.5);
    expect(t(nodes[2])).toBe(1);
  });

  it('is 0 everywhere when the metric is all zero (no git history)', () => {
    const nodes = [node('a'), node('b')];
    expect(metricScale(nodes, 'churn')(nodes[0])).toBe(0);
  });

  it('uses rank as-is: it is already normalized', () => {
    expect(metricScale([node('a', { rank: 0.3 })], 'rank')(node('a', { rank: 0.3 }))).toBe(0.3);
  });
});

describe('nodeVal', () => {
  it('sizes by the given 0..1 value, rank by default', () => {
    expect(nodeVal(node('a', { rank: 1 }))).toBe(nodeVal(node('b'), 1));
    expect(nodeVal(node('a'), 0)).toBeLessThan(nodeVal(node('a'), 1));
  });
});

describe('heatColor', () => {
  it('quantizes 0..1 into the ramp, cold to hot', () => {
    expect(heatColor(0)).toBe(HEAT_COLORS[0]);
    expect(heatColor(1)).toBe(HEAT_COLORS[HEAT_COLORS.length - 1]);
    expect(heatColor(0.5)).toBe(HEAT_COLORS[2]);
  });
});

describe('colorScale', () => {
  it('is null for kind coloring and a 0..1 scale for a metric', () => {
    const nodes = [node('a', { callers: 4 })];
    expect(colorScale(nodes, 'kind')).toBeNull();
    expect(colorScale(nodes, 'callers')!(nodes[0])).toBe(1);
  });
});

describe('parseSizeMetric / parseColorMode', () => {
  it('accepts known values and defaults otherwise', () => {
    expect(parseSizeMetric('churn')).toBe('churn');
    expect(parseSizeMetric('kind')).toBe('rank');
    expect(parseSizeMetric(null)).toBe('rank');
    expect(parseColorMode('loc')).toBe('loc');
    expect(parseColorMode('bogus')).toBe('kind');
  });
});

function rg(nodes: RenderNode[], links: Array<[string, string, CodeGraphDTO['links'][number]['type']]>) {
  return { revision: 'r', changed: [], nodes, links: links.map(([source, target, type]) => ({ source, target, type, weight: 1 })) };
}

describe('filterGraph', () => {
  const nodes: RenderNode[] = [
    node('f1', { kind: 'function' }), node('c1', { kind: 'class' }), node('t1', { kind: 'type', exported: false }),
  ];
  const g = rg(nodes, [['f1', 'c1', 'call'], ['c1', 't1', 'ref'], ['f1', 't1', 'ref']]);

  it('returns the graph itself when nothing is hidden', () => {
    expect(filterGraph(g, { hidden: new Set(), exportedOnly: false })).toBe(g);
  });

  it('drops hidden kinds and every link touching them, keeping node identity', () => {
    const out = filterGraph(g, { hidden: new Set(['class']), exportedOnly: false });
    expect(out.nodes.map((n) => n.id)).toEqual(['f1', 't1']);
    expect(out.nodes[0]).toBe(nodes[0]);
    expect(out.links.map((l) => `${l.source}>${l.target}`)).toEqual(['f1>t1']);
  });

  it('drops hidden link types but keeps their nodes', () => {
    const out = filterGraph(g, { hidden: new Set(['ref']), exportedOnly: false });
    expect(out.nodes).toHaveLength(3);
    expect(out.links.map((l) => l.type)).toEqual(['call']);
  });

  it('exportedOnly keeps the public surface', () => {
    const out = filterGraph(g, { hidden: new Set(), exportedOnly: true });
    expect(out.nodes.map((n) => n.id)).toEqual(['f1', 'c1']);
  });
});

describe('shortestPath', () => {
  const adj = buildAdjacency(rg([], [['a', 'b', 'call'], ['b', 'c', 'call'], ['a', 'x', 'call'], ['d', 'c', 'call']]).links);

  it('follows deps from A to B', () => {
    expect(shortestPath(adj, 'a', 'c')).toEqual(['a', 'b', 'c']);
  });

  it('falls back to undirected when no call chain exists', () => {
    expect(shortestPath(adj, 'a', 'd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is null when the nodes are not connected', () => {
    expect(shortestPath(adj, 'a', 'zzz')).toBeNull();
  });

  it('a node to itself is itself', () => {
    expect(shortestPath(adj, 'a', 'a')).toEqual(['a']);
  });
});

describe('neighbourAt', () => {
  const adj = buildAdjacency(rg([], [['a', 'b', 'call'], ['a', 'c', 'call'], ['z', 'a', 'call']]).links);
  const rank = new Map([['b', 0.2], ['c', 0.9], ['z', 0.5]]);

  it('steps through deps by rank, wrapping around', () => {
    expect(neighbourAt(adj, rank, 'a', 'deps', 0)).toBe('c');
    expect(neighbourAt(adj, rank, 'a', 'deps', 1)).toBe('b');
    expect(neighbourAt(adj, rank, 'a', 'deps', 2)).toBe('c');
  });

  it('steps through callers and is null with none', () => {
    expect(neighbourAt(adj, rank, 'a', 'callers', 0)).toBe('z');
    expect(neighbourAt(adj, rank, 'z', 'callers', 0)).toBeNull();
  });
});

describe('parseHidden / serializeHidden', () => {
  it('round-trips known kinds and link types, ignoring junk', () => {
    const hidden = parseHidden('callable,ref,bogus');
    expect([...hidden].sort()).toEqual(['callable', 'ref']);
    expect(serializeHidden(hidden)).toBe('callable,ref');
    expect(serializeHidden(new Set())).toBeUndefined();
    expect(parseHidden(null).size).toBe(0);
  });
});

describe('pathLinkKeys', () => {
  it('keys each consecutive hop in both directions', () => {
    expect([...pathLinkKeys(['a', 'b', 'c'])].sort()).toEqual(['a>b', 'b>a', 'b>c', 'c>b']);
    expect(pathLinkKeys(['a']).size).toBe(0);
  });
});

describe('reviewSpotlight', () => {
  const links = (pairs: [string, string][]) => mergeGraph(null, dto(
    [...new Set(pairs.flat())].map((id) => node(id)),
    pairs.map(([source, target]) => ({ source, target, type: 'call' as const, weight: 1 })),
  )).links;

  it('lights the changed nodes, their callers and the links between them', () => {
    const spot = reviewSpotlight(links([['caller', 'changed'], ['changed', 'dep'], ['other', 'dep']]), ['changed'], ['caller']);
    expect([...spot.nodes].sort()).toEqual(['caller', 'changed']);
    expect([...spot.links]).toEqual(['caller>changed']);
  });

  it('is empty when the branch changes nothing', () => {
    const spot = reviewSpotlight(links([['a', 'b']]), [], []);
    expect(spot.nodes.size).toBe(0);
    expect(spot.links.size).toBe(0);
  });
});

describe('impactDistance', () => {
  const adj = (pairs: [string, string][]) =>
    buildAdjacency(pairs.map(([source, target]) => ({ source, target, type: 'call' as const, weight: 1 })) as never);

  it('walks callers upstream from the changed nodes, nearest hop wins, changed nodes excluded', () => {
    const d = impactDistance(adj([['a', 'x'], ['b', 'a'], ['c', 'b'], ['b', 'y'], ['x', 'dep']]), ['x', 'y']);
    expect(Object.fromEntries(d)).toEqual({ a: 1, b: 1, c: 2 });
  });

  it('stops at maxHops and survives cycles', () => {
    const d = impactDistance(adj([['a', 'x'], ['b', 'a'], ['c', 'b'], ['x', 'c']]), ['x'], 2);
    expect(Object.fromEntries(d)).toEqual({ a: 1, b: 2 });
  });
});

describe('impactColor / reviewColor', () => {
  it('fades from the first ramp step to the last as hops grow, clamped', () => {
    expect(impactColor(1)).toBe(IMPACT_COLORS[0]);
    expect(impactColor(99)).toBe(IMPACT_COLORS[IMPACT_COLORS.length - 1]);
  });

  it('paints changed nodes by git status, impacted by distance, everything else dim', () => {
    const status = new Map([['n', 'added'], ['m', 'modified']] as const);
    const impact = new Map([['c', 1]]);
    expect(reviewColor('n', status, impact)).toBe(STATE_COLORS.added);
    expect(reviewColor('m', status, impact)).toBe(STATE_COLORS.modified);
    expect(reviewColor('c', status, impact)).toBe(IMPACT_COLORS[0]);
    expect(reviewColor('z', status, impact)).toBe(STATE_COLORS.dim);
  });
});

describe('nodeRadius3D', () => {
  it('matches the sphere the 3D engine draws: cube root of the value times the relative size', () => {
    expect(nodeRadius3D(8, 3)).toBeCloseTo(6);
    expect(nodeRadius3D(27, 1)).toBeCloseTo(3);
  });
});

describe('collideForce', () => {
  const at = (id: string, x: number, y = 0, z = 0): RenderNode => ({ ...node(id), x, y, z, vx: 0, vy: 0, vz: 0 });

  it('pushes two overlapping spheres apart along the line between them', () => {
    const nodes = [at('a', 0), at('b', 4)];
    const force = collideForce(() => 5, 0);
    force.initialize(nodes);
    force(1);
    expect(nodes[0].vx).toBeLessThan(0);
    expect(nodes[1].vx).toBeGreaterThan(0);
    expect(nodes[0].vx! + nodes[1].vx!).toBeCloseTo(0);
    expect(nodes[0].vy).toBe(0);
  });

  it('leaves spheres that only touch past the padding alone', () => {
    const nodes = [at('a', 0), at('b', 13)];
    const force = collideForce(() => 5, 2);
    force.initialize(nodes);
    force(1);
    expect(nodes[0].vx).toBe(0);
    expect(nodes[1].vx).toBe(0);
  });

  it('counts the padding as part of the overlap', () => {
    const nodes = [at('a', 0), at('b', 11)];
    const force = collideForce(() => 5, 2);
    force.initialize(nodes);
    force(1);
    expect(nodes[1].vx).toBeGreaterThan(0);
  });

  it('separates spheres in any axis, not just x', () => {
    const nodes = [at('a', 0, 0, 0), at('b', 0, 0, 3)];
    const force = collideForce(() => 5, 0);
    force.initialize(nodes);
    force(1);
    expect(nodes[1].vz).toBeGreaterThan(0);
  });

  it('splits two nodes at the same point instead of dividing by zero', () => {
    const nodes = [at('a', 1), at('b', 1)];
    const force = collideForce(() => 5, 0);
    force.initialize(nodes);
    force(1);
    expect(Number.isFinite(nodes[0].vx!)).toBe(true);
    expect(nodes[0].vx).not.toBe(nodes[1].vx);
  });

  it('reads each radius once per initialize, so a size change needs a re-init', () => {
    let r = 5;
    const nodes = [at('a', 0), at('b', 8)];
    const force = collideForce(() => r, 0);
    force.initialize(nodes);
    r = 1;
    force(1);
    expect(nodes[1].vx).toBeGreaterThan(0);
  });
});

describe('labelTop', () => {
  it('lifts a label clear of its node: above the projected radius plus the gap', () => {
    expect(labelTop(100, 12, 16, 4)).toBe(100 - 12 - 4 - 16);
  });

  it('never hides a tiny node under its own label', () => {
    expect(labelTop(100, 0, 16, 4)).toBe(80);
  });
});

describe('tooltipBox', () => {
  const view = { width: 800, height: 600 };

  it('sits right of the node disc, vertically centred on it', () => {
    expect(tooltipBox({ x: 100, y: 200 }, 10, 120, 40, view, 6)).toEqual({ x: 116, y: 180 });
  });

  it('flips to the left of the disc when it would leave the canvas on the right', () => {
    expect(tooltipBox({ x: 750, y: 200 }, 10, 120, 40, view, 6)).toEqual({ x: 750 - 10 - 6 - 120, y: 180 });
  });

  it('clamps into the canvas vertically', () => {
    expect(tooltipBox({ x: 100, y: 5 }, 10, 120, 40, view, 6).y).toBe(0);
    expect(tooltipBox({ x: 100, y: 595 }, 10, 120, 40, view, 6).y).toBe(560);
  });

  it('never covers the disc it describes', () => {
    for (const x of [20, 400, 790]) {
      const b = tooltipBox({ x, y: 300 }, 30, 120, 40, view, 6);
      expect(b.x >= x + 30 || b.x + 120 <= x - 30).toBe(true);
    }
  });
});
