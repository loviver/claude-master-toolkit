import { describe, expect, it } from 'vitest';
import {
  aggregateCells, ancestorsOf, autoCollapse, buildTree, containerOf, cycleSpans, orderTree, visibleRows,
} from '../matrix-tree';

const link = (source: string, target: string, weight = 1, type: 'call' | 'ref' | 'inherit' | 'dispatch' = 'call') =>
  ({ source, target, type, weight });

const sym = (file: string, name: string) => ({ id: `${file}::${name}`, file, label: name });
const file = (path: string) => ({ id: path, file: path, label: path.split('/').pop()! });

describe('containerOf', () => {
  it('groups a symbol under its file, a file under its folder and a module under its parent', () => {
    expect(containerOf({ id: 'src/a.ts::f', file: 'src/a.ts' })).toBe('src/a.ts');
    expect(containerOf({ id: 'src/a.ts', file: 'src/a.ts' })).toBe('src');
    expect(containerOf({ id: 'src/express', file: null })).toBe('src');
    expect(containerOf({ id: 'root.ts', file: 'root.ts' })).toBe('');
  });
});

describe('buildTree', () => {
  it('compresses single-child folder chains into one level', () => {
    const tree = buildTree([file('src/express/services/a.ts'), file('src/express/services/b.ts')]);
    // The whole chain collapses into the root: both files sit directly under it.
    expect(tree.path).toBe('src/express/services');
    expect(tree.children.map((c) => c.kind)).toEqual(['leaf', 'leaf']);
  });

  it('keeps sibling folders as groups and labels a compressed chain with its joined segments', () => {
    const tree = buildTree([file('src/a/x/one.ts'), file('src/b/two.ts')]);
    expect(tree.path).toBe('src');
    const labels = tree.children.map((c) => (c.kind === 'folder' ? c.folder.label : c.id)).sort();
    expect(labels).toEqual(['a/x', 'b']);
  });
});

describe('orderTree', () => {
  it('puts callees before callers inside every folder', () => {
    const nodes = [sym('src/m.ts', 'top'), sym('src/m.ts', 'mid'), sym('src/m.ts', 'leaf'), file('src/other.ts')];
    const links = [link('src/m.ts::top', 'src/m.ts::mid'), link('src/m.ts::mid', 'src/m.ts::leaf')];
    const rows = visibleRows(orderTree(buildTree(nodes), links), new Set()).rows;
    const ids = rows.map((r) => r.key);
    expect(ids.indexOf('src/m.ts::leaf')).toBeLessThan(ids.indexOf('src/m.ts::mid'));
    expect(ids.indexOf('src/m.ts::mid')).toBeLessThan(ids.indexOf('src/m.ts::top'));
  });

  it('orders folders by the dependencies between them', () => {
    const nodes = [file('src/ui/view.ts'), file('src/core/model.ts'), file('src/ui/x.ts'), file('src/core/y.ts')];
    const rows = visibleRows(orderTree(buildTree(nodes), [link('src/ui/view.ts', 'src/core/model.ts')]), new Set()).rows;
    expect(rows.findIndex((r) => r.key === 'src/core/model.ts')).toBeLessThan(rows.findIndex((r) => r.key === 'src/ui/view.ts'));
  });
});

describe('visibleRows', () => {
  const nodes = [file('src/a/one.ts'), file('src/a/two.ts'), file('src/b/three.ts'), file('src/b/four.ts')];

  it('emits a span per expanded folder and one leaf row per node', () => {
    const { rows, spans } = visibleRows(orderTree(buildTree(nodes), []), new Set());
    expect(rows).toHaveLength(4);
    expect(spans.map((s) => [s.path, s.end - s.start + 1, s.depth]).sort()).toEqual([['src/a', 2, 0], ['src/b', 2, 0]]);
  });

  it('folds a collapsed folder into one group row holding its members', () => {
    const { rows } = visibleRows(orderTree(buildTree(nodes), []), new Set(['src/a']));
    const group = rows.find((r) => r.kind === 'group')!;
    expect(rows).toHaveLength(3);
    expect(group.key).toBe('src/a');
    expect([...group.members].sort()).toEqual(['src/a/one.ts', 'src/a/two.ts']);
  });
});

describe('aggregateCells', () => {
  it('sums the weights of folded links, keeps the stronger type and drops links inside one row', () => {
    const nodes = [file('src/a/one.ts'), file('src/a/two.ts'), file('src/b/three.ts'), file('src/b/four.ts')];
    const links = [
      link('src/b/three.ts', 'src/a/one.ts', 2, 'ref'),
      link('src/b/four.ts', 'src/a/two.ts', 3, 'call'),
      link('src/a/one.ts', 'src/a/two.ts', 5),
    ];
    const { rows } = visibleRows(orderTree(buildTree(nodes), links), new Set(['src/a', 'src/b']));
    const { cells } = aggregateCells(rows, links);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ weight: 5, count: 2, type: 'call', inCycle: false });
  });

  it('flags a cycle on node level, even across folders, and lists it', () => {
    const nodes = [file('src/a/one.ts'), file('src/b/two.ts')];
    const links = [link('src/a/one.ts', 'src/b/two.ts'), link('src/b/two.ts', 'src/a/one.ts')];
    const { rows } = visibleRows(orderTree(buildTree(nodes), links), new Set());
    const { cells, cycles } = aggregateCells(rows, links);
    expect(cells.every((c) => c.inCycle)).toBe(true);
    // One of the two cells must sit above the diagonal: that is what makes a cycle visible.
    expect(cells.some((c) => c.col > c.row)).toBe(true);
    expect(cycles.map((c) => [...c].sort())).toEqual([['src/a/one.ts', 'src/b/two.ts']]);
  });

  it('marks a collapsed row that hides a cycle inside it', () => {
    const nodes = [file('src/a/one.ts'), file('src/a/two.ts'), file('src/b/x.ts')];
    const links = [link('src/a/one.ts', 'src/a/two.ts'), link('src/a/two.ts', 'src/a/one.ts')];
    const { rows } = visibleRows(orderTree(buildTree(nodes), links), new Set(['src/a']));
    expect(aggregateCells(rows, links).cyclicRows).toEqual(new Set([rows.findIndex((r) => r.key === 'src/a')]));
  });
});

describe('autoCollapse', () => {
  const nodes = ['a', 'b', 'c'].flatMap((d) => [1, 2, 3, 4].map((i) => file(`src/${d}/deep/f${i}.ts`)).concat(file(`src/${d}/top.ts`)));
  const tree = orderTree(buildTree(nodes), []);

  it('leaves everything open when it fits', () => {
    expect(autoCollapse(tree, 100).size).toBe(0);
  });

  it('collapses the deepest folders first until the rows fit the budget', () => {
    const collapsed = autoCollapse(tree, 9);
    expect(visibleRows(tree, collapsed).rows.length).toBeLessThanOrEqual(9);
    expect(collapsed.has('src/a/deep')).toBe(true);
    expect(collapsed.has('src/a')).toBe(false);
  });

  it('falls back to top-level folders when nothing smaller fits', () => {
    expect(visibleRows(tree, autoCollapse(tree, 1)).rows).toHaveLength(3);
  });
});

describe('cycleSpans', () => {
  it('reports the rows of each cycle and whether they are contiguous', () => {
    const rows = ['x', 'y', 'z'].map((key) => ({ key, kind: 'leaf' as const, depth: 0, label: key, members: [key] }));
    expect(cycleSpans(rows, [['x', 'y'], ['x', 'z']])).toEqual([
      { members: ['x', 'y'], rows: [0, 1], contiguous: true },
      { members: ['x', 'z'], rows: [0, 2], contiguous: false },
    ]);
  });
});

describe('ancestorsOf', () => {
  it('lists the folders to expand to reveal a node', () => {
    const tree = orderTree(buildTree([file('src/a/x/one.ts'), file('src/a/two.ts'), file('src/b/three.ts')]), []);
    expect(ancestorsOf(tree, 'src/a/x/one.ts')).toEqual(['src/a', 'src/a/x']);
    expect(ancestorsOf(tree, 'missing')).toEqual([]);
  });
});
