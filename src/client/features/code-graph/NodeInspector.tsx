import { useMemo } from 'react';
import { Crosshair, FolderOpen, X } from 'lucide-react';
import { Badge, Button, CopyableValue } from '../../components/ui';
import { formatRelativeTime } from '../../lib/format';
import type { CodeGraphLevel } from '../../lib/types';
import { drillTarget, type Neighbours, type RenderNode } from './graph-model';
import styles from './CodeGraph.module.css';

interface NodeInspectorProps {
  node: RenderNode;
  level: CodeGraphLevel;
  neighbours: Neighbours | undefined;
  nodesById: Map<string, RenderNode>;
  touched: boolean;
  blast: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onDrill: (target: NonNullable<ReturnType<typeof drillTarget>>) => void;
  onClose: () => void;
}

const LIST_MAX = 30;

function NeighbourList({ title, ids, nodesById, onSelect }: {
  title: string;
  ids: Set<string> | undefined;
  nodesById: Map<string, RenderNode>;
  onSelect: (id: string) => void;
}) {
  const sorted = useMemo(
    () => [...(ids ?? [])]
      .map((id) => nodesById.get(id))
      .filter((n): n is RenderNode => !!n)
      .sort((a, b) => b.rank - a.rank),
    [ids, nodesById],
  );
  return (
    <section className={styles.inspectorSection}>
      <h4 className={styles.inspectorHeading}>{title} <span>{sorted.length}</span></h4>
      {sorted.length === 0 ? (
        <p className={styles.muted}>None in view</p>
      ) : (
        <ul className={styles.neighbourList}>
          {sorted.slice(0, LIST_MAX).map((n) => (
            <li key={n.id}>
              <button type="button" className={styles.neighbour} onClick={() => onSelect(n.id)} title={n.id}>
                {n.label}
                <span>{n.kind}</span>
              </button>
            </li>
          ))}
          {sorted.length > LIST_MAX && <li className={styles.muted}>+{sorted.length - LIST_MAX} more</li>}
        </ul>
      )}
    </section>
  );
}

export function NodeInspector({
  node, level, neighbours, nodesById, touched, blast, onSelect, onFocus, onDrill, onClose,
}: NodeInspectorProps) {
  const drill = drillTarget(node, level);
  const location = node.file
    ? node.startLine !== null ? `${node.file}:${node.startLine}` : node.file
    : node.id;

  return (
    <aside className={styles.inspector} aria-label="Selected node">
      <header className={styles.inspectorHeader}>
        <div>
          <h3 className={styles.inspectorTitle}>{node.label}</h3>
          <div className={styles.badges}>
            <Badge>{node.kind}</Badge>
            {node.exported && <Badge variant="info">exported</Badge>}
            {touched && <Badge variant="error">changed on branch</Badge>}
            {blast && <Badge variant="warning">calls changed code</Badge>}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close inspector"><X size={14} /></Button>
      </header>

      <section className={styles.inspectorSection}>
        <CopyableValue value={location} mono maxChars={44} expandable label="Location" />
        {node.signature && <pre className={styles.signature}>{node.signature}</pre>}
        <dl className={styles.facts}>
          <dt>Rank</dt><dd>{(node.rank * 100).toFixed(1)}%</dd>
          {node.size > 1 && (<><dt>Symbols</dt><dd>{node.size}</dd></>)}
          {node.indexedAt > 0 && (<><dt>Indexed</dt><dd>{formatRelativeTime(node.indexedAt)}</dd></>)}
        </dl>
      </section>

      <div className={styles.inspectorActions}>
        <Button size="sm" onClick={() => onFocus(node.id)}><Crosshair size={14} /> Impact view</Button>
        {drill && (
          <Button size="sm" variant="ghost" onClick={() => onDrill(drill)}>
            <FolderOpen size={14} /> Open {drill.level === 'file' ? 'files' : 'symbols'}
          </Button>
        )}
      </div>

      <NeighbourList title="Used by" ids={neighbours?.callers} nodesById={nodesById} onSelect={onSelect} />
      <NeighbourList title="Depends on" ids={neighbours?.deps} nodesById={nodesById} onSelect={onSelect} />
    </aside>
  );
}
