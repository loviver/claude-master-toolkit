import { describe, expect, it } from 'vitest';
import type { RenderLink, RenderNode } from '../graph-model';
import {
  edgeIndex,
  groupRows,
  GROUP_THRESHOLD,
  neighbourRows,
  peekBack,
  peekPlacement,
  peekPush,
  peekWindow,
  PEEK_MAX,
  rankPosition,
  type PeekFrame,
} from '../inspector-model';

const node = (id: string, over: Partial<RenderNode> = {}): RenderNode => ({
  id,
  label: id,
  kind: 'class',
  file: `src/${id}.ts`,
  group: 'src',
  rank: 0.5,
  size: 1,
  exported: true,
  signature: null,
  startLine: 1,
  endLine: 10,
  indexedAt: 0,
  loc: 10,
  ...over,
} as RenderNode);

const link = (source: string, target: string, type: RenderLink['type'] = 'call', weight = 1): RenderLink => ({ source, target, type, weight });

describe('edgeIndex', () => {
  it('merges every link between the same pair: types collected, weights summed', () => {
    const idx = edgeIndex([link('a', 'b', 'call', 2), link('a', 'b', 'ref', 3), link('b', 'a')]);
    expect(idx.get('a>b')).toEqual({ types: ['call', 'ref'], weight: 5 });
    expect(idx.get('b>a')).toEqual({ types: ['call'], weight: 1 });
  });

  it('reads ends the layout engine swapped for node objects', () => {
    const idx = edgeIndex([{ source: node('a'), target: node('b'), type: 'inherit', weight: 1 }]);
    expect(idx.get('a>b')?.types).toEqual(['inherit']);
  });
});

describe('neighbourRows', () => {
  const nodes = new Map(['a', 'b', 'c', 'self'].map((id) => [id, node(id, { rank: id === 'c' ? 0.9 : 0.1 })]));
  const idx = edgeIndex([link('a', 'self', 'call', 4), link('c', 'self', 'ref'), link('self', 'b', 'inherit')]);
  const overlay = { touched: new Set(['a']), blast: new Set(['c']) };

  it('callers: the edge into the node, with its status, heaviest rank first', () => {
    const rows = neighbourRows(new Set(['a', 'c', 'gone']), 'self', 'callers', nodes, idx, overlay);
    expect(rows.map((r) => r.node.id)).toEqual(['c', 'a']);
    expect(rows[1]).toMatchObject({ types: ['call'], weight: 4, touched: true, blast: false });
    expect(rows[0]).toMatchObject({ types: ['ref'], touched: false, blast: true });
  });

  it('deps: the edge out of the node', () => {
    const [row] = neighbourRows(new Set(['b']), 'self', 'deps', nodes, idx, overlay);
    expect(row.types).toEqual(['inherit']);
  });

  it('puts changed neighbours first: they are what a review is about', () => {
    const rows = neighbourRows(new Set(['a', 'c']), 'self', 'callers', nodes, idx, { touched: new Set(['a']), blast: new Set() });
    expect(rows[0].node.id).toBe('a');
  });
});

describe('groupRows', () => {
  const rows = (files: Array<string | null>) =>
    files.map((file, i) => ({ node: node(`n${i}`, { file }), types: [], weight: 1, touched: false, blast: false }));

  it('keeps a short list flat', () => {
    const groups = groupRows(rows(['x.ts', 'y.ts']));
    expect(groups).toHaveLength(1);
    expect(groups[0].file).toBeNull();
  });

  it('groups a long list by file, biggest group first, file-less rows last', () => {
    const files = [...Array(GROUP_THRESHOLD).fill('a.ts'), 'b.ts', null, 'b.ts', 'b.ts', 'b.ts', 'b.ts', 'b.ts', 'b.ts', 'b.ts', 'b.ts', 'b.ts'];
    const groups = groupRows(rows(files));
    expect(groups.map((g) => [g.file, g.rows.length])).toEqual([['b.ts', 10], ['a.ts', GROUP_THRESHOLD], ['', 1]]);
  });

  it('stays flat when every row is in one file: a single group says nothing', () => {
    expect(groupRows(rows(Array(GROUP_THRESHOLD + 5).fill('a.ts')))[0].file).toBeNull();
  });
});

describe('rankPosition', () => {
  it('ranks among the nodes in view, 1-based', () => {
    const nodes = [node('a', { rank: 0.2 }), node('b', { rank: 1 }), node('c', { rank: 0.5 })];
    expect(rankPosition('c', nodes)).toEqual({ position: 2, total: 3 });
    expect(rankPosition('missing', nodes)).toBeNull();
  });
});

describe('peek stack', () => {
  const frame = (id: string): PeekFrame => ({ id, label: id, file: `${id}.ts`, range: [1, 5] });

  it('pushes a new frame and ignores re-peeking the one on top', () => {
    const s = peekPush(peekPush([], frame('a')), frame('b'));
    expect(s.map((f) => f.id)).toEqual(['a', 'b']);
    expect(peekPush(s, frame('b'))).toBe(s);
  });

  it('caps its depth, dropping the oldest', () => {
    let s: PeekFrame[] = [];
    for (let i = 0; i <= PEEK_MAX; i++) s = peekPush(s, frame(`f${i}`));
    expect(s).toHaveLength(PEEK_MAX);
    expect(s[0].id).toBe('f1');
  });

  it('goes back one frame but never empties the stack', () => {
    expect(peekBack([frame('a'), frame('b')]).map((f) => f.id)).toEqual(['a']);
    const one = [frame('a')];
    expect(peekBack(one)).toBe(one);
  });
});

describe('peekWindow', () => {
  it('shows the symbol with context around it', () => {
    expect(peekWindow([20, 30], 100)).toEqual([17, 33]);
  });

  it('clamps to the file', () => {
    expect(peekWindow([1, 3], 4)).toEqual([1, 4]);
  });

  it('cuts a long symbol to its head: the signature is what a peek is for', () => {
    expect(peekWindow([10, 500], 600, 3, 40)).toEqual([7, 46]);
  });

  it('a file-level node peeks at the top of the file', () => {
    expect(peekWindow(null, 600, 3, 40)).toEqual([1, 40]);
  });
});

describe('peekPlacement', () => {
  const viewport = { width: 1600, height: 900 };
  const size = { width: 600, height: 300 };

  it('opens above a row in the bottom panel, aligned to its left', () => {
    expect(peekPlacement({ left: 500, top: 700, bottom: 722 }, size, viewport)).toEqual({ left: 500, top: 396 });
  });

  it('flips below when there is no room above', () => {
    expect(peekPlacement({ left: 500, top: 100, bottom: 122 }, size, viewport)).toEqual({ left: 500, top: 126 });
  });

  it('stays inside the viewport horizontally', () => {
    expect(peekPlacement({ left: 1400, top: 700, bottom: 722 }, size, viewport).left).toBe(992);
  });
});
