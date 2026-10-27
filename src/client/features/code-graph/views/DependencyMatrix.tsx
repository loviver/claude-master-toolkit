import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CodeGraphLinkType } from '../../../lib/types';
import { LINK_COLORS, LINK_LABELS, STATE_COLORS, tooltipBox } from '../graph-model';
import { Codicon } from '../workbench/codicons';
import { Placeholder } from '../workbench/Workbench';
import { COL_SEL, CYCLE, MatrixCanvas, ROW_SEL, type Hit, type MatrixScene } from './MatrixCanvas';
import { fitCell, showRowLabels, visibleRange, zoomAt } from './matrix-geometry';
import { cellTone, diffSubset, rowPaint } from './matrix-subset';
import { aggregateCells, ancestorsOf, autoCollapse, buildTree, cycleSpans, orderTree, visibleRows } from './matrix-tree';
import type { GraphViewProps } from './types';
import styles from './Views.module.css';

const MAX_NODES = 3000;
/** Width of one nesting level of folder bars in the headers. */
const GUTTER = 12;
const MAX_GUTTERS = 6;
const LABEL_W = 220;
const NUM_H = 30;
/** Header room left for the state strip when the cells are too small for labels. */
const STRIP_W = 8;
const OVERSCAN = 4;
const TIP_W = 320;
const TIP_H = 96;

/**
 * Dependency structure matrix: row uses column. Rows nest by folder (and file at the symbol
 * level), each group ordered callees-first, so a healthy codebase sits below the diagonal and
 * anything above it points back up. Red is a cycle; review mode narrows it to the diff.
 */
export function DependencyMatrix({ graph, selectedId, overlay, onSelect }: GraphViewProps) {
  const [diffOnly, setDiffOnly] = useState(true);
  const [neighbours, setNeighbours] = useState(false);
  const subset = useMemo(
    () => (diffOnly ? diffSubset(graph.nodes.map((n) => n.id), graph.links, overlay, neighbours) : null),
    [graph, overlay, diffOnly, neighbours],
  );
  const nodes = useMemo(() => (subset ? graph.nodes.filter((n) => subset.has(n.id)) : graph.nodes), [graph, subset]);
  // Live refreshes and overlay updates rebuild the arrays; this only changes when the set of rows does.
  const nodeKey = useMemo(() => nodes.map((n) => n.id).sort().join('\n'), [nodes]);
  const tooLarge = nodes.length > MAX_NODES;
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const tree = useMemo(() => orderTree(buildTree(tooLarge ? [] : nodes), graph.links), [nodes, graph.links, tooLarge]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tooLarge]);

  // Folded folders: auto-sized to the viewport until the user expands or collapses one.
  const budget = Math.max(40, Math.floor((Math.min(view.w, view.h) - 60) / 11));
  const auto = useMemo(() => autoCollapse(tree, budget), [tree, budget]);
  const [manual, setManual] = useState<{ key: string; set: Set<string> } | null>(null);
  const collapsed = manual?.key === nodeKey ? manual.set : auto;
  const setCollapsed = (set: Set<string>) => setManual({ key: nodeKey, set });
  const expand = (paths: string[]) => {
    if (!paths.some((p) => collapsed.has(p))) return;
    const next = new Set(collapsed);
    paths.forEach((p) => next.delete(p));
    setCollapsed(next);
  };
  const collapse = (path: string) => setCollapsed(new Set(collapsed).add(path));

  const { rows, spans } = useMemo(() => visibleRows(tree, collapsed), [tree, collapsed]);
  const agg = useMemo(() => aggregateCells(rows, graph.links), [rows, graph.links]);
  const cycles = useMemo(() => cycleSpans(rows, agg.cycles), [rows, agg.cycles]);
  const paints = useMemo(() => rows.map((r) => rowPaint(r.members, overlay)), [rows, overlay]);
  const cellAt = useMemo(() => new Map(agg.cells.map((c) => [`${c.row}:${c.col}`, c])), [agg.cells]);
  const rowOf = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r, i) => r.members.forEach((id) => map.set(id, i)));
    return map;
  }, [rows]);
  const maxWeight = useMemo(() => Math.max(1, ...agg.cells.map((c) => c.weight)), [agg.cells]);
  const linkTypes = useMemo(() => [...new Set(agg.cells.map((c) => c.type))].sort() as CodeGraphLinkType[], [agg.cells]);

  const n = rows.length;
  const [cell, setCell] = useState(12);
  const labels = showRowLabels(cell);
  const depthW = Math.min(MAX_GUTTERS, spans.reduce((m, s) => Math.max(m, s.depth + 1), 0)) * GUTTER;
  const rowHeadW = depthW + (labels ? LABEL_W : STRIP_W);
  const colHeadH = depthW + (labels ? NUM_H : STRIP_W);
  const size = n * cell;
  const bodyW = Math.max(0, Math.min(view.w - rowHeadW, size));
  const bodyH = Math.max(0, Math.min(view.h - colHeadH, size));

  const fit = () => {
    const avail = (withLabels: boolean) => Math.min(
      view.w - depthW - (withLabels ? LABEL_W : STRIP_W),
      view.h - depthW - (withLabels ? NUM_H : STRIP_W),
    );
    const withLabels = fitCell(n, avail(true));
    setCell(showRowLabels(withLabels) ? withLabels : fitCell(n, avail(false)));
    scrollRef.current?.scrollTo(0, 0);
  };
  const viewReady = view.w > 0;
  useLayoutEffect(() => { if (viewReady) fit(); }, [nodeKey, viewReady]);

  // Zoom keeps the cell under the cursor still: apply the matching scroll once the new size is laid out.
  const pendingScroll = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pendingScroll.current) el.scrollTo(pendingScroll.current.x, pendingScroll.current.y);
    pendingScroll.current = null;
  }, [cell]);
  /** `point` is relative to the scroll viewport; without one the zoom centers on the visible body. */
  const zoom = (factor: number, point?: { x: number; y: number }) => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = point ? { x: point.x - rowHeadW, y: point.y - colHeadH } : { x: bodyW / 2, y: bodyH / 2 };
    const next = zoomAt({ cell, scrollX: el.scrollLeft, scrollY: el.scrollTop }, factor, anchor);
    pendingScroll.current = { x: next.scrollX, y: next.scrollY };
    setCell(next.cell);
  };
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(Math.exp(-e.deltaY * 0.002), { x: e.clientX - r.left - el.clientLeft, y: e.clientY - r.top - el.clientTop });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [tooLarge]);

  const selected = selectedId ? rowOf.get(selectedId) ?? -1 : -1;
  // A selection made elsewhere (tree, search, code) opens its folders and scrolls its row into view.
  useEffect(() => {
    if (selectedId) expand(ancestorsOf(tree, selectedId));
  }, [selectedId]);
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !selectedId || selected < 0 || rows[selected].key !== selectedId || revealed.current === selectedId) return;
    revealed.current = selectedId;
    const top = selected * cell;
    const viewH = el.clientHeight - colHeadH;
    if (top < el.scrollTop || top + cell > el.scrollTop + viewH) el.scrollTo({ top: top - viewH / 2, left: Math.max(0, top - bodyW / 2) });
  }, [selectedId, selected, rows, cell]);

  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<Hit | null>(null);
  const [cyclesOpen, setCyclesOpen] = useState(false);

  const labelOf = (id: string) => byId.get(id)?.label ?? id;
  const activate = ({ row, col }: Hit, shift: boolean) => {
    const groups = [rows[row], rows[col]].filter((r) => r.kind === 'group').map((r) => r.key);
    if (groups.length) expand(groups);
    else onSelect(shift ? rows[col].key : rows[row].key);
  };
  const focusCycle = (members: string[]) => {
    expand(members.flatMap((id) => ancestorsOf(tree, id)));
    onSelect(members[0]);
    setCyclesOpen(false);
  };

  /** Viewport point (relative to the matrix area) of a cell, for the keyboard tooltip. */
  const cellPoint = ({ row, col }: Hit) => ({
    x: rowHeadW + (col + 0.5) * cell - scroll.x,
    y: colHeadH + (row + 0.5) * cell - scroll.y,
  });
  const moveCursor = (next: Hit) => {
    const hit = { row: Math.min(n - 1, Math.max(0, next.row)), col: Math.min(n - 1, Math.max(0, next.col)) };
    setCursor(hit);
    const el = scrollRef.current;
    if (!el) return;
    const viewH = el.clientHeight - colHeadH;
    const viewW = el.clientWidth - rowHeadW;
    let { scrollTop: y, scrollLeft: x } = el;
    if (hit.row * cell < y) y = hit.row * cell;
    if ((hit.row + 1) * cell > y + viewH) y = (hit.row + 1) * cell - viewH;
    if (hit.col * cell < x) x = hit.col * cell;
    if ((hit.col + 1) * cell > x + viewW) x = (hit.col + 1) * cell - viewW;
    el.scrollTo(x, y);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!n) return;
    const at = cursor ?? { row: Math.max(0, selected), col: Math.max(0, selected) };
    const step: Record<string, Hit> = {
      ArrowUp: { row: at.row - 1, col: at.col }, ArrowDown: { row: at.row + 1, col: at.col },
      ArrowLeft: { row: at.row, col: at.col - 1 }, ArrowRight: { row: at.row, col: at.col + 1 },
    };
    if (step[e.key]) moveCursor(step[e.key]);
    else if (e.key === 'Enter') activate(at, e.shiftKey);
    else if (e.key === ']' && rows[at.row].kind === 'group') expand([rows[at.row].key]);
    else if (e.key === '[') {
      const inner = spans.filter((s) => s.start <= at.row && at.row <= s.end).sort((a, b) => b.depth - a.depth)[0];
      if (inner) collapse(inner.path);
    } else if (e.key === 'Escape') setCursor(null);
    else return;
    e.preventDefault();
  };

  const scene = useMemo<MatrixScene>(() => ({
    n, cell, cells: agg.cells, spans, cycles, paints, cyclicRows: agg.cyclicRows, selected,
    hover: hover?.hit ?? null, cursor, maxWeight,
  }), [n, cell, agg, spans, cycles, paints, selected, hover, cursor, maxWeight]);

  if (tooLarge) {
    return <Placeholder icon="table" title="Too many nodes for a matrix">
      {nodes.length.toLocaleString()} nodes: switch to Modules or Files, scope to a folder, or use the impact view.
    </Placeholder>;
  }

  const rowRange = visibleRange(Math.max(0, scroll.y - OVERSCAN * cell), view.h + 2 * OVERSCAN * cell, cell, n);
  const colRange = visibleRange(Math.max(0, scroll.x - OVERSCAN * cell), view.w + 2 * OVERSCAN * cell, cell, n);
  const inRows = (start: number, end: number) => end >= rowRange.first && start <= rowRange.last;
  const inCols = (start: number, end: number) => end >= colRange.first && start <= colRange.last;
  const barSpans = spans.filter((s) => s.depth < MAX_GUTTERS);
  const tipHit = hover?.hit ?? cursor;
  const tipPoint = hover ?? (cursor ? cellPoint(cursor) : null);
  const tip = tipHit && tipPoint ? (
    <Tooltip
      content={tooltipFor(tipHit)}
      at={tooltipBox(tipPoint, cell / 2, TIP_W, TIP_H, { width: areaRef.current?.clientWidth ?? 0, height: areaRef.current?.clientHeight ?? 0 }, 12)}
    />
  ) : null;

  function tooltipFor({ row, col }: Hit): ReactNode {
    const r = rows[row];
    const c = rows[col];
    const name = (x: typeof r) => (x.kind === 'group' ? `${x.label}/ (${x.members.length})` : x.label);
    if (row === col) {
      return <>
        <b>{name(r)}</b>
        {r.kind === 'group' && <div className={styles.tipDim}>Folded folder · click to expand</div>}
        {agg.cyclicRows.has(row) && <div style={{ color: CYCLE }}>Hides a cycle among its members</div>}
      </>;
    }
    const data = cellAt.get(`${row}:${col}`);
    if (!data) return <><b>{name(r)}</b> <span className={styles.tipDim}>does not use</span> <b>{name(c)}</b></>;
    const tone = cellTone(paints[row], paints[col]);
    return <>
      <b>{name(r)}</b> → <b>{name(c)}</b>
      <div className={styles.tipDim}>
        {LINK_LABELS[data.type]} · ×{data.weight}{data.count > 1 && ` · ${data.count} links`}
        {col > row && ' · points back up'}
      </div>
      {data.inCycle && <div style={{ color: CYCLE }}>Part of a cycle</div>}
      {tone === 'changed' && <div style={{ color: STATE_COLORS.modified }}>Both ends changed on this branch</div>}
      {tone === 'affected' && <div style={{ color: STATE_COLORS.blast }}>One end changed on this branch</div>}
      {(r.kind === 'group' || c.kind === 'group') && data.samples.map(([s, t]) => (
        <div key={`${s}>${t}`} className={styles.tipDim}>{labelOf(s)} → {labelOf(t)}</div>
      ))}
      <div className={styles.tipDim}>{r.kind === 'group' || c.kind === 'group' ? 'Click to expand' : 'Click: select row · Shift+click: column'}</div>
    </>;
  }

  return (
    <div className={styles.matrixRoot}>
      <div className={styles.matrixBar}>
        <span>{n.toLocaleString()} rows · {nodes.length.toLocaleString()}{subset && ` of ${graph.nodes.length.toLocaleString()}`} nodes</span>
        {overlay.impact && <>
          <label className={styles.toggle}><input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} />Diff only</label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={neighbours} disabled={!diffOnly} onChange={(e) => setNeighbours(e.target.checked)} />+ neighbours
          </label>
        </>}
        <BarButton icon="expand-all" title="Expand all folders" onClick={() => setCollapsed(new Set())} />
        <BarButton icon="collapse-all" title="Collapse to top-level folders" onClick={() => setCollapsed(autoCollapse(tree, 1))} />
        <BarButton icon="zoom-out" title="Zoom out (Ctrl+wheel)" onClick={() => zoom(1 / 1.25)} />
        <BarButton icon="zoom-in" title="Zoom in (Ctrl+wheel)" onClick={() => zoom(1.25)} />
        <BarButton icon="screen-full" title="Fit (double-click the matrix)" onClick={fit} />
        {agg.cycles.length > 0 && (
          <span className={styles.popoverHost}>
            <button type="button" className={styles.barBtn} style={{ color: CYCLE }} aria-expanded={cyclesOpen} onClick={() => setCyclesOpen((o) => !o)}>
              <Codicon name="error" /> {agg.cycles.length} cycle{agg.cycles.length > 1 ? 's' : ''} <Codicon name="chevron-down" />
            </button>
            {cyclesOpen && (
              <ul className={styles.popover}>
                {agg.cycles.map((members) => (
                  <li key={members.join('|')}>
                    <button type="button" className={styles.popoverItem} onClick={() => focusCycle(members)}>
                      {members.slice(0, 4).map(labelOf).join(' → ')}{members.length > 4 ? ` → +${members.length - 4}` : ` → ${labelOf(members[0])}`}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </span>
        )}
        <ul className={styles.matrixLegend} aria-label="Legend">
          {linkTypes.map((t) => <li key={t}><i style={{ background: LINK_COLORS[t] }} />{LINK_LABELS[t]}</li>)}
          <li><i style={{ background: CYCLE }} />Cycle</li>
          {overlay.impact && <li><i style={{ background: STATE_COLORS.modified }} />Changed link</li>}
          <li><i style={{ background: ROW_SEL }} />Row uses</li>
          <li><i style={{ background: COL_SEL }} />Column used by</li>
        </ul>
      </div>

      <div className={styles.matrixArea} ref={areaRef}>
        {n === 0 ? (
          <Placeholder icon="table" title="Nothing to show">No node in this view{subset && ' touches the diff'}.</Placeholder>
        ) : (
          <div
            ref={scrollRef}
            className={styles.matrixScroll}
            tabIndex={0}
            aria-label="Dependency matrix: arrows move, Enter selects, [ ] fold"
            onKeyDown={onKeyDown}
            onScroll={(e) => setScroll({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })}
          >
            <div className={styles.matrixGrid} style={{ gridTemplateColumns: `${rowHeadW}px ${size}px`, gridTemplateRows: `${colHeadH}px ${size}px` }}>
              <div className={styles.matrixCorner} />

              <div className={styles.colHead}>
                {barSpans.filter((s) => inCols(s.start, s.end)).map((s) => (
                  <button
                    key={s.path}
                    type="button"
                    className={styles.spanBar}
                    style={{ left: s.start * cell, width: (s.end - s.start + 1) * cell - 1, top: s.depth * GUTTER, height: GUTTER - 2 }}
                    title={`${s.path} · click to fold`}
                    onClick={() => collapse(s.path)}
                  >{(s.end - s.start + 1) * cell > 40 && s.label}</button>
                ))}
                {labels && Array.from({ length: Math.max(0, colRange.last - colRange.first + 1) }, (_, k) => colRange.first + k).map((i) => (
                  <span
                    key={i}
                    className={styles.colNum}
                    style={{
                      left: i * cell, width: cell, height: NUM_H, color: paints[i].color ?? undefined,
                      background: i === selected ? withAlpha(COL_SEL) : hover?.hit.col === i ? 'var(--vscode-list-hoverBackground)' : undefined,
                    }}
                  >{i + 1}</span>
                ))}
              </div>

              <div className={styles.rowHead}>
                {barSpans.filter((s) => inRows(s.start, s.end)).map((s) => (
                  <button
                    key={s.path}
                    type="button"
                    className={`${styles.spanBar} ${styles.spanBarV}`}
                    style={{ top: s.start * cell, height: (s.end - s.start + 1) * cell - 1, left: s.depth * GUTTER, width: GUTTER - 2 }}
                    title={`${s.path} · click to fold`}
                    onClick={() => collapse(s.path)}
                  >{(s.end - s.start + 1) * cell > 40 && s.label}</button>
                ))}
                {Array.from({ length: Math.max(0, rowRange.last - rowRange.first + 1) }, (_, k) => rowRange.first + k).map((i) => {
                  const r = rows[i];
                  const p = paints[i];
                  if (!labels) {
                    return p.color && <span key={i} className={styles.rowStrip} style={{ top: i * cell, height: cell, left: depthW, background: p.color }} />;
                  }
                  return (
                    <button
                      key={`${r.kind}:${r.key}`}
                      type="button"
                      className={styles.rowLabel}
                      style={{
                        top: i * cell, height: cell, left: depthW, width: LABEL_W,
                        fontSize: cell >= 14 ? 12 : 10, opacity: p.dim ? 0.5 : 1,
                        fontWeight: i === selected ? 700 : undefined,
                        background: i === selected ? withAlpha(ROW_SEL) : hover?.hit.row === i ? 'var(--vscode-list-hoverBackground)' : undefined,
                      }}
                      title={r.kind === 'group' ? `${r.key} · ${r.members.length} nodes · click to expand` : r.key}
                      onClick={() => (r.kind === 'group' ? expand([r.key]) : onSelect(r.key))}
                    >
                      <span className={styles.rowNum}>{i + 1}</span>
                      {r.kind === 'group' && <Codicon name="chevron-right" />}
                      <span className={styles.rowText} style={{ color: p.color ?? undefined }}>{r.label}</span>
                      {r.kind === 'group' && <span className={styles.rowNum}>{r.members.length}</span>}
                    </button>
                  );
                })}
              </div>

              <div className={styles.matrixBody}>
                <MatrixCanvas
                  scene={scene}
                  width={bodyW}
                  height={bodyH}
                  style={{ position: 'sticky', top: colHeadH, left: rowHeadW, display: 'block', cursor: 'pointer' }}
                  scrollKey={`${scroll.x}:${scroll.y}`}
                  onHover={(hit, client) => {
                    const area = areaRef.current?.getBoundingClientRect();
                    setHover(hit && client && area ? { hit, x: client.x - area.left, y: client.y - area.top } : null);
                  }}
                  onActivate={activate}
                  onDoubleClick={fit}
                />
              </div>
            </div>
          </div>
        )}
        {tip}
      </div>
    </div>
  );
}

const withAlpha = (hex: string) => `color-mix(in srgb, ${hex} 22%, transparent)`;

function BarButton({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.barBtn} title={title} aria-label={title} onClick={onClick}>
      <Codicon name={icon} />
    </button>
  );
}

function Tooltip({ content, at }: { content: ReactNode; at: { x: number; y: number } }) {
  return <div className={styles.matrixTip} style={{ left: at.x, top: at.y, maxWidth: TIP_W }}>{content}</div>;
}
