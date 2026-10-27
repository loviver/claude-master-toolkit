/** Pixel math of the matrix canvas: cell size, hit testing, the visible window and zoom around the cursor. */

export const MIN_CELL = 3;
export const MAX_CELL = 32;
/** Smallest cell a row label still fits in. */
const LABEL_CELL = 10;

export function clampCell(cell: number): number {
  return Math.min(MAX_CELL, Math.max(MIN_CELL, cell));
}

/** The largest whole cell that fits `n` rows into `available` pixels. */
export function fitCell(n: number, available: number): number {
  return clampCell(Math.floor(available / Math.max(n, 1)));
}

/** The cell under a point in content pixels, or null outside the matrix. */
export function hitCell(x: number, y: number, cell: number, n: number): { row: number; col: number } | null {
  const row = Math.floor(y / cell);
  const col = Math.floor(x / cell);
  return x < 0 || y < 0 || row >= n || col >= n ? null : { row, col };
}

/** Rows (or columns) inside a viewport of `size` pixels scrolled by `scroll`. */
export function visibleRange(scroll: number, size: number, cell: number, n: number): { first: number; last: number } {
  const first = Math.max(0, Math.floor(scroll / cell));
  return { first, last: Math.min(n - 1, Math.ceil((scroll + size) / cell) - 1) };
}

export interface ZoomState {
  cell: number;
  scrollX: number;
  scrollY: number;
}

/** Scale the cells by `factor`, keeping the content under `anchor` (viewport pixels) still. */
export function zoomAt(state: ZoomState, factor: number, anchor: { x: number; y: number }): ZoomState {
  const cell = clampCell(state.cell * factor);
  const k = cell / state.cell;
  return {
    cell,
    scrollX: Math.max(0, (state.scrollX + anchor.x) * k - anchor.x),
    scrollY: Math.max(0, (state.scrollY + anchor.y) * k - anchor.y),
  };
}

export function showRowLabels(cell: number): boolean {
  return cell >= LABEL_CELL;
}
