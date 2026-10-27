import { useMemo, useState } from 'react';
import { LINK_COLORS, STATE_COLORS } from '../graph-model';
import { Placeholder } from '../../../shell/workbench/Workbench';
import { buildClassModel, type ClassBox } from './class-model';
import { layoutLayers } from './layers-model';
import type { GraphViewProps } from './types';
import { usePanZoom } from './usePanZoom';
import styles from './Views.module.css';

const W = 210;
const HEAD = 26;
const LINE = 15;
const MAX_MEMBERS = 10;
const GAP_X = 28;
const GAP_Y = 56;

const boxHeight = (b: ClassBox) => HEAD + Math.min(b.members.length, MAX_MEMBERS) * LINE + (b.members.length > MAX_MEMBERS ? LINE : 0) + 6;

/** UML-style class diagram of the current scope: members inside the box, supertypes above, uses dashed. */
export function ClassDiagram({ graph, selectedId, overlay, onSelect, level }: GraphViewProps & { level: string }) {
  const model = useMemo(() => buildClassModel(graph.nodes, graph.links), [graph]);
  const layout = useMemo(() => {
    const ids = model.boxes.map((b) => b.id);
    const l = layoutLayers(ids, model.inherits.map((i) => ({ source: i.base, target: i.sub })));
    const perRow = Math.max(4, Math.ceil(Math.sqrt(ids.length)));
    const byId = new Map(model.boxes.map((b) => [b.id, b]));
    const rows: string[][] = l.layers.flatMap((layer) => {
      const chunks: string[][] = [];
      for (let i = 0; i < layer.length; i += perRow) chunks.push(layer.slice(i, i + perRow));
      return chunks;
    });
    const width = Math.max(1, ...rows.map((r) => r.length)) * (W + GAP_X) + GAP_X;
    const pos = new Map<string, { x: number; y: number; h: number }>();
    let y = GAP_Y / 2;
    for (const row of rows) {
      const rowH = Math.max(...row.map((id) => boxHeight(byId.get(id)!)));
      const rowW = row.length * (W + GAP_X) - GAP_X;
      row.forEach((id, i) => pos.set(id, { x: (width - rowW) / 2 + i * (W + GAP_X), y, h: boxHeight(byId.get(id)!) }));
      y += rowH + GAP_Y;
    }
    return { pos, width, height: y };
  }, [model]);
  const view = usePanZoom({ w: layout.width, h: layout.height });
  const [hovered, setHovered] = useState<string | null>(null);
  const focus = hovered ?? selectedId;

  if (level !== 'symbol') {
    return <Placeholder icon="symbol-class" title="Classes need the Symbols level">
      Pick <b>Symbols</b> in the status bar, ideally scoped to a folder or file with classes.
    </Placeholder>;
  }
  if (model.boxes.length === 0) {
    return <Placeholder icon="symbol-class" title="No classes in this scope">
      Scope to a folder that declares classes or interfaces (for example <code>src/cli/agents</code>).
    </Placeholder>;
  }

  const anchor = (id: string, edge: 'top' | 'bottom') => {
    const p = layout.pos.get(id)!;
    return { x: p.x + W / 2, y: edge === 'top' ? p.y : p.y + p.h };
  };

  return (
    <>
      <svg ref={view.ref} className={styles.svg} viewBox={view.viewBox} {...view.handlers} role="img" aria-label="Class diagram">
        <defs>
          <marker id="uml-inherit" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto">
            <path d="M1,1 L11,6 L1,11 z" fill="var(--vscode-editor-background)" stroke={LINK_COLORS.inherit} />
          </marker>
          <marker id="uml-use" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#888" />
          </marker>
        </defs>
        {model.uses.map((u) => {
          const a = layout.pos.get(u.from);
          const b = layout.pos.get(u.to);
          if (!a || !b) return null;
          const lit = !focus || u.from === focus || u.to === focus;
          const down = a.y <= b.y;
          const s = anchor(u.from, down ? 'bottom' : 'top');
          const t = anchor(u.to, down ? 'top' : 'bottom');
          const my = (s.y + t.y) / 2;
          return (
            <path key={`${u.from}>${u.to}`} d={`M${s.x},${s.y} C${s.x},${my} ${t.x},${my} ${t.x},${t.y}`} fill="none" stroke="#888" strokeDasharray="4 3" opacity={lit ? (focus ? 0.9 : 0.35) : 0.04} markerEnd="url(#uml-use)" />
          );
        })}
        {model.inherits.map((i) => {
          if (!layout.pos.has(i.sub) || !layout.pos.has(i.base)) return null;
          const s = anchor(i.sub, 'top');
          const t = anchor(i.base, 'bottom');
          const my = (s.y + t.y) / 2;
          return <path key={`${i.sub}^${i.base}`} d={`M${s.x},${s.y} C${s.x},${my} ${t.x},${my} ${t.x},${t.y}`} fill="none" stroke={LINK_COLORS.inherit} strokeWidth={1.5} markerEnd="url(#uml-inherit)" />;
        })}
        {model.boxes.map((b) => {
          const p = layout.pos.get(b.id);
          if (!p) return null;
          const ring = overlay.touched.has(b.id) ? STATE_COLORS.touched : overlay.blast.has(b.id) ? STATE_COLORS.blast : null;
          const shown = b.members.slice(0, MAX_MEMBERS);
          return (
            <g
              key={b.id}
              data-node=""
              className={styles.hit}
              transform={`translate(${p.x},${p.y})`}
              onPointerEnter={() => setHovered(b.id)}
              onPointerLeave={() => setHovered(null)}
              onClick={() => onSelect(b.id === selectedId ? null : b.id)}
            >
              <rect width={W} height={p.h} rx={3} fill="var(--vscode-editorWidget-background)" stroke={b.id === selectedId ? STATE_COLORS.selected : ring ?? 'var(--vscode-panel-border)'} strokeWidth={b.id === selectedId || ring ? 2 : 1} />
              <rect width={W} height={HEAD} rx={3} fill="var(--vscode-list-hoverBackground)" />
              <text className={styles.label} x={W / 2} y={b.kind === 'interface' ? 11 : 17} textAnchor="middle" style={{ fontWeight: 700 }}>
                {b.kind === 'interface' ? '«interface»' : b.name.slice(0, 28)}
              </text>
              {b.kind === 'interface' && <text className={styles.label} x={W / 2} y={22} textAnchor="middle" style={{ fontWeight: 700 }}>{b.name.slice(0, 28)}</text>}
              {shown.map((m, i) => (
                <text key={m.id} className={`${styles.label} ${m.exported ? '' : styles.labelDim}`} x={8} y={HEAD + 12 + i * LINE}>
                  {(m.kind === 'method' ? '+ ' : '· ') + (m.signature ?? m.name).slice(0, 32)}
                </text>
              ))}
              {b.members.length > MAX_MEMBERS && <text className={`${styles.label} ${styles.labelDim}`} x={8} y={HEAD + 12 + MAX_MEMBERS * LINE}>… {b.members.length - MAX_MEMBERS} more</text>}
              <title>{b.id}</title>
            </g>
          );
        })}
      </svg>
      <div className={styles.hint}>
        <span style={{ color: LINK_COLORS.inherit }}>▷</span> extends / implements · dashed = uses · wheel zoom · drag pan
      </div>
    </>
  );
}
