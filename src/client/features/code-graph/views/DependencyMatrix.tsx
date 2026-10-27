import { useMemo, useState } from 'react';
import { KIND_COLORS, STATE_COLORS, kindCategory } from '../graph-model';
import { Placeholder } from '../workbench/Workbench';
import { buildMatrix } from './matrix-model';
import type { GraphViewProps } from './types';
import styles from './Views.module.css';

const CYCLE = '#f14c4c';
const LABEL_W = 190;
const MAX_NODES = 700;

/** Dependency structure matrix: row uses column. Below the diagonal is healthy; red is a cycle. */
export function DependencyMatrix({ graph, selectedId, overlay, onSelect }: GraphViewProps) {
  const matrix = useMemo(() => buildMatrix(graph.nodes.map((n) => n.id), graph.links), [graph]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const n = matrix.order.length;

  if (n > MAX_NODES) {
    return <Placeholder icon="table" title="Too many nodes for a matrix">
      {n.toLocaleString()} nodes: switch to Modules or Files, scope to a folder, or use the impact view.
    </Placeholder>;
  }

  const cell = Math.max(6, Math.min(22, Math.floor(720 / Math.max(n, 1))));
  const showLabels = cell >= 10;
  const size = n * cell;
  const header = showLabels ? LABEL_W : 24;
  const labelColor = (id: string) => (overlay.touched.has(id) ? STATE_COLORS.touched : overlay.blast.has(id) ? STATE_COLORS.blast : undefined);
  const nameOf = (id: string) => byId.get(id)?.label ?? id;
  const maxWeight = Math.max(1, ...matrix.cells.map((c) => c.weight));

  return (
    <div className={styles.scroll}>
      <svg width={header + size + 16} height={header + size + 16} role="img" aria-label="Dependency matrix">
        <g transform={`translate(${header},${header})`} onPointerLeave={() => setHover(null)}>
          {/* Guides for the hovered / selected row and column. */}
          {matrix.order.map((id, i) => (
            (hover?.row === i || hover?.col === i || selectedId === id) && (
              <g key={`g${id}`} fill="var(--vscode-list-hoverBackground)">
                {(hover?.row === i || selectedId === id) && <rect x={0} y={i * cell} width={size} height={cell} />}
                {(hover?.col === i || selectedId === id) && <rect x={i * cell} y={0} width={cell} height={size} />}
              </g>
            )
          ))}
          <rect width={size} height={size} fill="none" stroke="var(--vscode-panel-border)" />
          {matrix.order.map((id, i) => (
            <rect key={`d${id}`} x={i * cell} y={i * cell} width={cell} height={cell} fill={KIND_COLORS[kindCategory(byId.get(id)?.kind ?? 'value')]} opacity={0.5} />
          ))}
          {matrix.cells.map((c) => (
            <rect
              key={`${c.source}>${c.target}`}
              className={styles.hit}
              x={c.col * cell + 0.5}
              y={c.row * cell + 0.5}
              width={cell - 1}
              height={cell - 1}
              fill={c.inCycle ? CYCLE : '#a7a6fa'}
              opacity={0.35 + 0.65 * Math.min(1, Math.log2(c.weight + 1) / Math.log2(maxWeight + 1))}
              onPointerEnter={() => setHover({ row: c.row, col: c.col })}
              onClick={() => onSelect(c.source)}
            >
              <title>{`${nameOf(c.source)} → ${nameOf(c.target)}${c.weight > 1 ? ` (×${c.weight})` : ''}${c.inCycle ? ' · cycle' : ''}`}</title>
            </rect>
          ))}
          {showLabels && matrix.order.map((id, i) => (
            <g key={`l${id}`} className={styles.hit} onClick={() => onSelect(id)}>
              <text
                className={styles.label}
                x={-6}
                y={i * cell + cell / 2 + 4}
                textAnchor="end"
                style={{ fill: labelColor(id), fontWeight: selectedId === id ? 700 : 400 }}
              >
                {nameOf(id).slice(0, 28)}
              </text>
              <text
                className={`${styles.label} ${styles.labelDim}`}
                transform={`translate(${i * cell + cell / 2 + 4},-6) rotate(-60)`}
                style={{ fill: labelColor(id) }}
              >
                {nameOf(id).slice(0, 28)}
              </text>
              <title>{id}</title>
            </g>
          ))}
        </g>
      </svg>
      <div className={styles.hint}>
        row uses column · below the diagonal = clean · <span style={{ color: CYCLE }}>red</span> = cycle
        {matrix.cycles.length > 0 && ` · ${matrix.cycles.length} cycle${matrix.cycles.length > 1 ? 's' : ''}`}
      </div>
    </div>
  );
}
