import { useMemo } from 'react';
import VscodeBadge from '@vscode-elements/react-elements/dist/components/VscodeBadge.js';
import VscodeButton from '@vscode-elements/react-elements/dist/components/VscodeButton.js';
import VscodeCollapsible from '@vscode-elements/react-elements/dist/components/VscodeCollapsible.js';
import VscodeToolbarButton from '@vscode-elements/react-elements/dist/components/VscodeToolbarButton.js';
import { formatRelativeTime } from '../../lib/format';
import type { CodeGraphLevel } from '../../lib/types';
import { drillTarget, type Neighbours, type RenderNode } from './graph-model';
import { Codicon } from './workbench/codicons';
import list from './workbench/list.module.css';
import styles from './Panels.module.css';

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
  /** Open the node's file in an editor tab; absent for nodes without one. */
  onViewCode?: () => void;
  /** Show the symbol's usages, call and type hierarchy; symbol nodes only. */
  onUsages?: () => void;
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
    <VscodeCollapsible heading={title} open>
      <VscodeBadge variant="counter" slot="decorations">{sorted.length}</VscodeBadge>
      {sorted.length === 0 ? (
        <p className={list.empty}>None in view</p>
      ) : (
        <ul className={list.list}>
          {sorted.slice(0, LIST_MAX).map((n) => (
            <li key={n.id}>
              <button type="button" className={list.row} onClick={() => onSelect(n.id)} title={n.id}>
                <span className={list.twistie} />
                <span className={list.label}>{n.label}</span>
                <span className={list.description}>{n.kind}</span>
              </button>
            </li>
          ))}
          {sorted.length > LIST_MAX && <li className={list.empty}>+{sorted.length - LIST_MAX} more</li>}
        </ul>
      )}
    </VscodeCollapsible>
  );
}

export function NodeInspector({
  node, level, neighbours, nodesById, touched, blast, onSelect, onFocus, onDrill, onViewCode, onUsages,
}: NodeInspectorProps) {
  const drill = drillTarget(node, level);
  const location = node.file
    ? node.startLine !== null ? `${node.file}:${node.startLine}` : node.file
    : node.id;

  return (
    <div className={styles.inspector} aria-label="Selected node">
      <header className={styles.inspectorHeader}>
        <h3 className={styles.inspectorTitle}>{node.label}</h3>
        <div className={styles.badges}>
          <VscodeBadge>{node.kind}</VscodeBadge>
          {node.exported && <VscodeBadge>exported</VscodeBadge>}
          {touched && <span className={styles.touched}><Codicon name="diff-modified" /> changed</span>}
          {blast && <span className={styles.blast}><Codicon name="warning" /> calls changed code</span>}
        </div>
        <div className={styles.location}>
          <span title={location}>{location}</span>
          <VscodeToolbarButton icon="copy" label="Copy location" onClick={() => void navigator.clipboard?.writeText(location)} />
        </div>
        {node.signature && <pre className={styles.signature}>{node.signature}</pre>}
        <dl className={styles.facts}>
          <dt>Rank</dt><dd>{(node.rank * 100).toFixed(1)}%</dd>
          {node.size > 1 && (<><dt>Symbols</dt><dd>{node.size}</dd></>)}
          {node.indexedAt > 0 && (<><dt>Indexed</dt><dd>{formatRelativeTime(node.indexedAt)}</dd></>)}
        </dl>
        <div className={styles.actionsRow}>
          <VscodeButton icon="target" onClick={() => onFocus(node.id)}>Impact view</VscodeButton>
          {onViewCode && <VscodeButton secondary icon="go-to-file" onClick={onViewCode}>Open code</VscodeButton>}
          {onUsages && <VscodeButton secondary icon="references" onClick={onUsages}>Find usages</VscodeButton>}
          {drill && (
            <VscodeButton secondary icon="folder-opened" onClick={() => onDrill(drill)}>
              {drill.level === 'file' ? 'Files' : 'Symbols'}
            </VscodeButton>
          )}
        </div>
      </header>

      <NeighbourList title="Used by" ids={neighbours?.callers} nodesById={nodesById} onSelect={onSelect} />
      <NeighbourList title="Depends on" ids={neighbours?.deps} nodesById={nodesById} onSelect={onSelect} />
    </div>
  );
}
