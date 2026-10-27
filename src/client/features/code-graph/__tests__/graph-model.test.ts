import { describe, it, expect } from 'vitest';
import type { CodeGraphDTO, CodeGraphNodeDTO, CodeGraphProjectDTO } from '../../../lib/types';
import {
  buildAdjacency,
  clusterForce,
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
    rank: 0.5, size: 1, exported: true, signature: null, startLine: 1, endLine: 2, indexedAt: 100, ...over,
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
