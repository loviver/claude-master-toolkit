import { describe, it, expect } from 'vitest';
import type { CodeGraphDTO, CodeGraphNodeDTO, CodeGraphProjectDTO } from '../../../lib/types';
import {
  buildAdjacency,
  defaultLevel,
  drillTarget,
  escapeHtml,
  kindCategory,
  linkEnds,
  mergeGraph,
  searchNodes,
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
