import { describe, expect, it } from 'vitest';
import type { CodeGraphOverlay } from '../../CodeGraph3D';
import { STATE_COLORS, impactColor } from '../../graph-model';
import { cellTone, diffSubset, rowPaint } from '../matrix-subset';

const overlay = (patch: Partial<CodeGraphOverlay> = {}): CodeGraphOverlay => ({
  touched: new Set(), blast: new Set(), hot: new Set(), path: new Set(), pathLinks: new Set(),
  status: new Map(), viewing: new Set(), impact: null, ...patch,
});
const link = (source: string, target: string) => ({ source, target, type: 'call' as const, weight: 1 });

describe('diffSubset', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const links = [link('b', 'a'), link('c', 'b'), link('d', 'e')];

  it('keeps everything outside review mode', () => {
    expect(diffSubset(ids, links, overlay({ touched: new Set(['a']) }), false)).toBeNull();
  });

  it('keeps the changed nodes and their impact in review mode', () => {
    const o = overlay({ touched: new Set(['a']), impact: new Map([['b', 1]]) });
    expect(diffSubset(ids, links, o, false)).toEqual(new Set(['a', 'b']));
  });

  it('adds direct neighbours on demand and ignores ids not in the graph', () => {
    const o = overlay({ touched: new Set(['a', 'zzz']), impact: new Map() });
    expect(diffSubset(ids, links, o, true)).toEqual(new Set(['a', 'b']));
  });
});

describe('rowPaint', () => {
  it('paints review rows git-style: status first, then the closest impact hop', () => {
    const o = overlay({
      touched: new Set(['a']), status: new Map([['a', 'added']]), impact: new Map([['b', 2], ['c', 1]]),
    });
    expect(rowPaint(['a'], o).color).toBe(STATE_COLORS.added);
    expect(rowPaint(['b', 'c'], o).color).toBe(impactColor(1));
    expect(rowPaint(['a'], o).touched).toBe(true);
  });

  it('paints touched over blast over viewing outside review', () => {
    const o = overlay({ touched: new Set(['t']), blast: new Set(['b']), viewing: new Set(['v', 'b']) });
    expect(rowPaint(['v', 'b'], o).color).toBe(STATE_COLORS.blast);
    expect(rowPaint(['v', 't'], o).color).toBe(STATE_COLORS.touched);
    expect(rowPaint(['v'], o).color).toBe(STATE_COLORS.viewing);
    expect(rowPaint(['x'], o).color).toBeNull();
  });

  it('dims rows off a traced path or review spotlight', () => {
    const o = overlay({ path: new Set(['a']) });
    expect(rowPaint(['a', 'x'], o).dim).toBe(false);
    expect(rowPaint(['x'], o).dim).toBe(true);
    expect(rowPaint(['x'], overlay()).dim).toBe(false);
  });
});

describe('cellTone', () => {
  const p = (touched: boolean, dim = false) => ({ color: null, touched, dim });
  it('ranks changed > affected > dim > normal', () => {
    expect(cellTone(p(true), p(true))).toBe('changed');
    expect(cellTone(p(true, true), p(false))).toBe('affected');
    expect(cellTone(p(false, true), p(false))).toBe('dim');
    expect(cellTone(p(false), p(false))).toBe('normal');
  });
});
