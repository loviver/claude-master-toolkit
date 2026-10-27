import { describe, expect, it } from 'vitest';
import { layoutTreemap, squarify } from '../treemap-model';

describe('squarify', () => {
  const rect = { x: 0, y: 0, w: 100, h: 50 };

  it('tiles the rectangle: areas are proportional and sum to the whole', () => {
    const out = squarify([{ id: 'a', value: 6 }, { id: 'b', value: 3 }, { id: 'c', value: 1 }], rect);
    const area = (r: { w: number; h: number }) => r.w * r.h;
    expect(out.reduce((n, r) => n + area(r), 0)).toBeCloseTo(5000, 3);
    expect(area(out.find((r) => r.id === 'a')!)).toBeCloseTo(3000, 3);
    expect(area(out.find((r) => r.id === 'c')!)).toBeCloseTo(500, 3);
  });

  it('keeps every tile inside the rectangle', () => {
    for (const r of squarify(Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, value: i + 1 })), rect)) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(100 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(50 + 1e-9);
    }
  });

  it('drops empty values and handles no items', () => {
    expect(squarify([], rect)).toEqual([]);
    expect(squarify([{ id: 'z', value: 0 }], rect)).toEqual([]);
  });
});

describe('layoutTreemap', () => {
  const files = [
    { file: 'src/a/x.ts', symbols: 10, indexedAt: 1 },
    { file: 'src/a/y.ts', symbols: 30, indexedAt: 1 },
    { file: 'src/b/z.ts', symbols: 20, indexedAt: 1 },
  ];

  it('nests files in folders sized by symbol count', () => {
    const cells = layoutTreemap(files, new Set(), { x: 0, y: 0, w: 600, h: 400 });
    const dirs = cells.filter((c) => c.kind === 'dir');
    expect(dirs.map((d) => d.path).sort()).toEqual(['src', 'src/a', 'src/b']);
    const leaf = (p: string) => cells.find((c) => c.path === p)!;
    expect(leaf('src/a/y.ts').w * leaf('src/a/y.ts').h).toBeGreaterThan(leaf('src/a/x.ts').w * leaf('src/a/x.ts').h);
  });

  it('flags changed files and their folders', () => {
    const cells = layoutTreemap(files, new Set(['src/b/z.ts']), { x: 0, y: 0, w: 600, h: 400 });
    expect(cells.find((c) => c.path === 'src/b/z.ts')!.changed).toBe(true);
    expect(cells.find((c) => c.path === 'src/b')!.changed).toBe(true);
    expect(cells.find((c) => c.path === 'src/a')!.changed).toBe(false);
  });

  it('zooms into a folder', () => {
    const cells = layoutTreemap(files, new Set(), { x: 0, y: 0, w: 600, h: 400 }, 'src/a');
    expect(cells.every((c) => c.path.startsWith('src/a'))).toBe(true);
    expect(cells.filter((c) => c.kind === 'file')).toHaveLength(2);
  });
});
