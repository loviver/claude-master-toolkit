import { useMemo, useState } from 'react';
import { KIND_COLORS, LINK_COLORS, STATE_COLORS, kindCategory, linkEnds } from '../graph-model';
import { Placeholder } from '../../../shell/workbench/Workbench';
import { edgeKey, layoutLayers } from './layers-model';
import type { GraphViewProps } from './types';
import { usePanZoom } from './usePanZoom';
import styles from './Views.module.css';

const W = 150;
const H = 24;
const GAP_X = 18;
const GAP_Y = 70;
const CYCLE = '#f14c4c';
const MAX_NODES = 500;
const PER_ROW = 10;

/** Layered architecture view: callers above what they use; red edges are cycles that break the layering. */
export function LayeredView({ graph, selectedId, overlay, onSelect }: GraphViewProps) {
  const layout = useMemo(() => {
    const ids = graph.nodes.map((n) => n.id);
    const edges = graph.links.map((l) => ({ source: linkEnds(l)[0], target: linkEnds(l)[1] }));
    const layers = layoutLayers(ids, edges);
    // A layer wider than a row wraps onto further rows so the diagram stays readable when zoomed to fit.
    const rows = layers.layers.flatMap((layer) => {
      const chunks: string[][] = [];
      for (let i = 0; i < layer.length; i += PER_ROW) chunks.push(layer.slice(i, i + PER_ROW));
      return chunks;
    });
    const widest = Math.max(1, ...rows.map((r) => r.length));
    const width = widest * (W + GAP_X) + GAP_X;
    const pos = new Map<string, { x: number; y: number }>();
    rows.forEach((row, r) => {
      const rowW = row.length * (W + GAP_X) - GAP_X;
      row.forEach((id, i) => pos.set(id, { x: (width - rowW) / 2 + i * (W + GAP_X), y: GAP_Y / 2 + r * (H + GAP_Y) }));
    });
    return { ...layers, pos, width, height: rows.length * (H + GAP_Y) + GAP_Y / 2 };
  }, [graph]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const [hovered, setHovered] = useState<string | null>(null);
  const view = usePanZoom({ w: layout.width, h: layout.height });
  const focus = hovered ?? selectedId;

  const near = useMemo(() => {
    if (!focus) return null;
    const set = new Set([focus]);
    for (const l of graph.links) {
      const [s, t] = linkEnds(l);
      if (s === focus) set.add(t);
      if (t === focus) set.add(s);
    }
    return set;
  }, [focus, graph]);

  if (graph.nodes.length > MAX_NODES) {
    return <Placeholder icon="layers" title="Too many nodes for layers">
      {graph.nodes.length.toLocaleString()} nodes: use Modules or Files, scope to a folder, or the impact view.
    </Placeholder>;
  }

  return (
    <>
      <svg ref={view.ref} className={styles.svg} viewBox={view.viewBox} {...view.handlers} role="img" aria-label="Layered dependency view">
        <defs>
          <marker id="layer-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
          </marker>
        </defs>
        <g fill="none">
          {graph.links.map((l, i) => {
            const [s, t] = linkEnds(l);
            const a = layout.pos.get(s);
            const b = layout.pos.get(t);
            if (!a || !b) return null;
            const cyclic = layout.cyclic.has(edgeKey(s, t));
            const lit = !near || (near.has(s) && near.has(t) && (s === focus || t === focus));
            const x1 = a.x + W / 2;
            const x2 = b.x + W / 2;
            const sameLayer = layout.layerOf.get(s) === layout.layerOf.get(t);
            const y1 = a.y + (sameLayer ? 0 : H);
            const y2 = b.y + (sameLayer ? 0 : 0);
            const my = (y1 + y2) / 2 + (sameLayer ? -28 : 0);
            return (
              <path
                key={i}
                d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
                stroke={cyclic ? CYCLE : LINK_COLORS[l.type]}
                strokeWidth={lit && near ? 2 : 1}
                opacity={lit ? (near ? 0.95 : 0.4) : 0.05}
                markerEnd="url(#layer-arrow)"
              />
            );
          })}
        </g>
        {layout.layers.flatMap((layer) => layer).map((id) => {
          const n = byId.get(id);
          const p = layout.pos.get(id);
          if (!n || !p) return null;
          const dim = near && !near.has(id);
          const ring = overlay.touched.has(id) ? STATE_COLORS.touched : overlay.blast.has(id) ? STATE_COLORS.blast : null;
          return (
            <g
              key={id}
              data-node=""
              className={styles.hit}
              transform={`translate(${p.x},${p.y})`}
              opacity={dim ? 0.2 : 1}
              onPointerEnter={() => setHovered(id)}
              onPointerLeave={() => setHovered(null)}
              onClick={() => onSelect(id === selectedId ? null : id)}
            >
              <rect
                width={W}
                height={H}
                rx={3}
                fill="var(--vscode-editorWidget-background)"
                stroke={id === selectedId ? STATE_COLORS.selected : ring ?? KIND_COLORS[kindCategory(n.kind)]}
                strokeWidth={id === selectedId || ring ? 2 : 1}
              />
              <rect width={4} height={H} rx={2} fill={KIND_COLORS[kindCategory(n.kind)]} />
              <text className={styles.label} x={11} y={H / 2 + 4}>{n.label.slice(0, 22)}</text>
              <title>{id}</title>
            </g>
          );
        })}
      </svg>
      <div className={styles.hint}>
        callers above · <span style={{ color: CYCLE }}>red</span> = cycle · wheel zoom · drag pan · double-click reset
      </div>
    </>
  );
}
