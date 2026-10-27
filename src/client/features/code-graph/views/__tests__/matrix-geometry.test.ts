import { describe, expect, it } from 'vitest';
import { MAX_CELL, MIN_CELL, clampCell, fitCell, hitCell, showRowLabels, visibleRange, zoomAt } from '../matrix-geometry';

describe('clampCell / fitCell', () => {
  it('keeps the cell size within bounds', () => {
    expect(clampCell(1)).toBe(MIN_CELL);
    expect(clampCell(500)).toBe(MAX_CELL);
    expect(clampCell(12.7)).toBe(12.7);
  });

  it('fits every row into the viewport when it can', () => {
    expect(fitCell(20, 400)).toBe(20);
    expect(fitCell(1000, 400)).toBe(MIN_CELL);
    expect(fitCell(2, 400)).toBe(MAX_CELL);
  });
});

describe('hitCell', () => {
  it('maps content pixels to a cell and rejects the outside', () => {
    expect(hitCell(0, 0, 10, 5)).toEqual({ row: 0, col: 0 });
    expect(hitCell(49.9, 10, 10, 5)).toEqual({ row: 1, col: 4 });
    expect(hitCell(50, 10, 10, 5)).toBeNull();
    expect(hitCell(-1, 10, 10, 5)).toBeNull();
  });
});

describe('visibleRange', () => {
  it('covers only the rows in view, clamped to the matrix', () => {
    expect(visibleRange(25, 30, 10, 100)).toEqual({ first: 2, last: 5 });
    expect(visibleRange(0, 5000, 10, 100)).toEqual({ first: 0, last: 99 });
    expect(visibleRange(0, 100, 10, 0)).toEqual({ first: 0, last: -1 });
  });
});

describe('zoomAt', () => {
  it('keeps the content point under the cursor in place', () => {
    const before = { cell: 10, scrollX: 100, scrollY: 40 };
    const anchor = { x: 50, y: 20 };
    const after = zoomAt(before, 2, anchor);
    expect(after.cell).toBe(20);
    expect((after.scrollX + anchor.x) / after.cell).toBeCloseTo((before.scrollX + anchor.x) / before.cell);
    expect((after.scrollY + anchor.y) / after.cell).toBeCloseTo((before.scrollY + anchor.y) / before.cell);
  });

  it('never scrolls before the origin and respects the cell bounds', () => {
    const after = zoomAt({ cell: MIN_CELL, scrollX: 0, scrollY: 0 }, 0.1, { x: 30, y: 30 });
    expect(after).toEqual({ cell: MIN_CELL, scrollX: 0, scrollY: 0 });
  });
});

describe('showRowLabels', () => {
  it('needs room for a line of text', () => {
    expect(showRowLabels(9)).toBe(false);
    expect(showRowLabels(10)).toBe(true);
  });
});
