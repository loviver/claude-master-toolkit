import { describe, it, expect } from 'vitest';
import {
  ancestorDirs,
  buildFileTree,
  lineChanged,
  matchFiles,
  nodeIdForFile,
  seedPosition,
} from '../explorer-model';

const f = (file: string, symbols = 1) => ({ file, symbols, indexedAt: 0 });

describe('buildFileTree', () => {
  it('nests files under folders, sorted, with counts of files and changes below each folder', () => {
    const tree = buildFileTree(
      [f('src/b.ts'), f('src/a.ts'), f('src/lib/x.ts'), f('README.ts'), f('test/t.ts')],
      new Set(['src/lib/x.ts', 'src/a.ts']),
    );
    expect(tree.files.map((x) => x.name)).toEqual(['README.ts']);
    expect(tree.dirs.map((d) => d.name)).toEqual(['src', 'test']);
    const src = tree.dirs[0];
    expect(src.files.map((x) => [x.name, x.changed])).toEqual([['a.ts', true], ['b.ts', false]]);
    expect(src).toMatchObject({ fileCount: 3, changed: 2 });
    expect(tree).toMatchObject({ fileCount: 5, changed: 2 });
  });

  it('collapses chains of single-child folders into one row, keeping the deepest path', () => {
    const tree = buildFileTree([f('src/client/features/a.ts'), f('src/client/features/b.ts')], new Set());
    expect(tree.dirs).toHaveLength(1);
    expect(tree.dirs[0]).toMatchObject({ name: 'src/client/features', path: 'src/client/features', fileCount: 2 });
  });

  it('stops collapsing at a folder that holds files', () => {
    const tree = buildFileTree([f('src/index.ts'), f('src/lib/a.ts')], new Set());
    expect(tree.dirs[0]).toMatchObject({ name: 'src', path: 'src' });
    expect(tree.dirs[0].dirs[0]).toMatchObject({ name: 'lib', path: 'src/lib' });
  });
});

describe('ancestorDirs', () => {
  it('lists every folder above a file, outermost first', () => {
    expect(ancestorDirs('src/client/a.ts')).toEqual(['src', 'src/client']);
    expect(ancestorDirs('root.ts')).toEqual([]);
  });
});

describe('matchFiles', () => {
  it('ranks basename prefixes over path substrings', () => {
    const files = [f('src/graph/view.ts'), f('src/code-graph.ts'), f('src/graph-model.ts')];
    expect(matchFiles(files, 'graph').map((x) => x.file)).toEqual([
      'src/graph-model.ts',
      'src/code-graph.ts',
      'src/graph/view.ts',
    ]);
    expect(matchFiles(files, '  ')).toEqual([]);
  });
});

describe('nodeIdForFile', () => {
  it('maps a file to its node at each level', () => {
    expect(nodeIdForFile('module', 'src/a/b.ts')).toBe('src/a');
    expect(nodeIdForFile('module', 'b.ts')).toBe('.');
    expect(nodeIdForFile('file', 'src/a/b.ts')).toBe('src/a/b.ts');
    expect(nodeIdForFile('symbol', 'src/a/b.ts')).toBeNull();
  });
});

describe('lineChanged', () => {
  it('checks inclusive spans', () => {
    expect(lineChanged(3, [[1, 3]])).toBe(true);
    expect(lineChanged(4, [[1, 3], [6, 6]])).toBe(false);
    expect(lineChanged(6, [[1, 3], [6, 6]])).toBe(true);
  });
});

describe('seedPosition', () => {
  it('is deterministic and keeps a zone’s members around its own centre', () => {
    expect(seedPosition('a', 0, 4)).toEqual(seedPosition('a', 0, 4));
    const east = seedPosition('x', 0, 2);
    const west = seedPosition('x', 1, 2);
    expect(east.x).toBeGreaterThan(0);
    expect(west.x).toBeLessThan(0);
  });
});
