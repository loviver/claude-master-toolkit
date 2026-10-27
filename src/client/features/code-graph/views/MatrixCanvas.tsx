import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { LINK_COLORS, STATE_COLORS } from '../graph-model';
import { hitCell, visibleRange } from './matrix-geometry';
import { cellTone, type RowPaint } from './matrix-subset';
import type { AggregatedCell, CycleSpan, GroupSpan } from './matrix-tree';

// Canvas cannot read CSS variables: literals tuned for the dark workbench (see CANVAS_BG).
export const CYCLE = '#f14c4c';
export const ROW_SEL = '#4daafc';               // --vscode-focusBorder: what the selected row uses
export const COL_SEL = '#c69be8';               // --purple-300: what uses the selected column
const BAND_ALPHA = 0.16;
const HOVER = 'rgba(255, 255, 255, 0.05)';
const DIAGONAL = 'rgba(255, 255, 255, 0.08)';
const UPPER = 'rgba(241, 76, 76, 0.035)';       // above the diagonal: a dependency pointing back up
const BLOCK = 'rgba(255, 255, 255, 0.025)';
const GRID = ['rgba(255, 255, 255, 0.22)', 'rgba(255, 255, 255, 0.12)', 'rgba(255, 255, 255, 0.07)'];

export type Hit = { row: number; col: number };

export interface MatrixScene {
  n: number;
  cell: number;
  cells: AggregatedCell[];
  spans: GroupSpan[];
  cycles: CycleSpan[];
  paints: RowPaint[];
  /** Collapsed rows hiding a cycle among their members. */
  cyclicRows: ReadonlySet<number>;
  /** Row (and column) of the selected node, -1 for none. */
  selected: number;
  hover: Hit | null;
  /** Keyboard cursor. */
  cursor: Hit | null;
  maxWeight: number;
}

/**
 * The matrix body. It is only as large as the viewport and stays put (sticky) while its
 * parent scrolls, so it can draw thousands of rows: each frame paints the visible window.
 */
export function MatrixCanvas({ scene, width, height, style, scrollKey, onHover, onActivate, onDoubleClick }: {
  scene: MatrixScene;
  width: number;
  height: number;
  style: CSSProperties;
  /** Changes whenever the parent scrolls, so the visible window is redrawn. */
  scrollKey: string;
  onHover: (hit: Hit | null, client: { x: number; y: number } | null) => void;
  onActivate: (hit: Hit, shift: boolean) => void;
  onDoubleClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  /** Content coordinates (matrix pixels) of the canvas' top-left corner: sticky decides where it sits. */
  const origin = () => {
    const canvas = ref.current!;
    const box = canvas.getBoundingClientRect();
    const parent = canvas.parentElement!.getBoundingClientRect();
    return { x: box.left - parent.left, y: box.top - parent.top, box };
  };

  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
    const o = origin();
    ctx.setTransform(dpr, 0, 0, dpr, -o.x * dpr, -o.y * dpr);
    drawMatrix(ctx, scene, { x: o.x, y: o.y, w: width, h: height });
  }, [scene, width, height, scrollKey]);

  const hitAt = (e: React.PointerEvent | React.MouseEvent): Hit | null => {
    const o = origin();
    return hitCell(o.x + e.clientX - o.box.left, o.y + e.clientY - o.box.top, scene.cell, scene.n);
  };

  return (
    <canvas
      ref={ref}
      style={{ ...style, width, height }}
      onPointerMove={(e) => onHover(hitAt(e), { x: e.clientX, y: e.clientY })}
      onPointerLeave={() => onHover(null, null)}
      onClick={(e) => {
        const hit = hitAt(e);
        if (hit) onActivate(hit, e.shiftKey);
      }}
      onDoubleClick={onDoubleClick}
    />
  );
}

function band(ctx: CanvasRenderingContext2D, color: string, alpha: number, x: number, y: number, w: number, h: number) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Paints the window `view` (content pixels) of the matrix. Order: zones, bands, diagonal, cells, structure. */
export function drawMatrix(ctx: CanvasRenderingContext2D, scene: MatrixScene, view: { x: number; y: number; w: number; h: number }) {
  const { n, cell, paints, selected, hover } = scene;
  const size = n * cell;
  const rows = visibleRange(view.y, view.h, cell, n);
  const cols = visibleRange(view.x, view.w, cell, n);
  const inView = (row: number, col: number) => row >= rows.first && row <= rows.last && col >= cols.first && col <= cols.last;

  ctx.globalAlpha = 1;
  ctx.clearRect(view.x, view.y, view.w, view.h);

  ctx.fillStyle = UPPER;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, 0);
  ctx.lineTo(size, size);
  ctx.closePath();
  ctx.fill();

  for (const s of scene.spans) {
    if (s.depth === 0) band(ctx, BLOCK, 1, s.start * cell, s.start * cell, (s.end - s.start + 1) * cell, (s.end - s.start + 1) * cell);
  }

  if (hover) {
    band(ctx, HOVER, 1, 0, hover.row * cell, size, cell);
    band(ctx, HOVER, 1, hover.col * cell, 0, cell, size);
  }
  if (selected >= 0) {
    band(ctx, ROW_SEL, BAND_ALPHA, 0, selected * cell, size, cell);
    band(ctx, COL_SEL, BAND_ALPHA, selected * cell, 0, cell, size);
  }

  for (let i = Math.max(rows.first, cols.first); i <= Math.min(rows.last, cols.last); i++) {
    const color = scene.cyclicRows.has(i) ? CYCLE : paints[i]?.color;
    band(ctx, color ?? DIAGONAL, color ? 0.45 : 1, i * cell, i * cell, cell, cell);
  }

  const pad = cell >= 6 ? 1 : 0;
  const logMax = Math.log2(scene.maxWeight + 1);
  for (const c of scene.cells) {
    if (!inView(c.row, c.col)) continue;
    const tone = cellTone(paints[c.row], paints[c.col]);
    let alpha = tone === 'dim' ? 0.18 : 0.45 + 0.55 * Math.min(1, Math.log2(c.weight + 1) / logMax);
    if (tone === 'changed' || tone === 'affected') alpha = 1;
    if (selected >= 0 && c.row !== selected && c.col !== selected) alpha *= 0.4;
    const color = c.inCycle ? CYCLE : tone === 'changed' ? STATE_COLORS.modified : LINK_COLORS[c.type];
    band(ctx, color, alpha, c.col * cell + pad, c.row * cell + pad, cell - 2 * pad, cell - 2 * pad);
  }

  // Folder boundaries run across the whole matrix, so a cell reads as "this folder uses that one".
  ctx.globalAlpha = 1;
  for (const s of scene.spans) {
    ctx.fillStyle = GRID[Math.min(s.depth, GRID.length - 1)];
    for (const at of [s.start * cell, (s.end + 1) * cell]) {
      ctx.fillRect(0, at, size, 1);
      ctx.fillRect(at, 0, 1, size);
    }
  }
  ctx.strokeStyle = GRID[0];
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

  ctx.strokeStyle = CYCLE;
  ctx.lineWidth = 1.5;
  for (const cyc of scene.cycles) {
    if (!cyc.contiguous || cyc.rows.length < 2) continue;
    const start = cyc.rows[0] * cell;
    const side = cyc.rows.length * cell;
    ctx.strokeRect(start + 0.75, start + 0.75, side - 1.5, side - 1.5);
  }

  if (scene.cursor) {
    ctx.strokeStyle = ROW_SEL;
    ctx.lineWidth = 2;
    ctx.strokeRect(scene.cursor.col * cell + 1, scene.cursor.row * cell + 1, cell - 2, cell - 2);
  }
}
