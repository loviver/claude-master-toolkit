import { useMemo, type CSSProperties } from 'react';
import VscodeBadge from '@vscode-elements/react-elements/dist/components/VscodeBadge.js';
import VscodeButton from '@vscode-elements/react-elements/dist/components/VscodeButton.js';
import VscodeCollapsible from '@vscode-elements/react-elements/dist/components/VscodeCollapsible.js';
import VscodeToolbarButton from '@vscode-elements/react-elements/dist/components/VscodeToolbarButton.js';
import { formatRelativeTime } from '../../lib/format';
import type { CodeGraphLevel } from '../../lib/types';
import { drillTarget, LINK_COLORS, LINK_LABELS, type Neighbours, type RenderNode } from './graph-model';
import { groupRows, neighbourRows, rankPosition, type EdgeInfo, type NeighbourRow, type PeekFrame } from './inspector-model';
import { symbolIcon } from './nav-model';
import { PeekPopover, usePeek, type Peek, type ResolveDeclaration } from './PeekPopover';
import { Codicon } from './workbench/codicons';
import list from './workbench/list.module.css';
import styles from './Panels.module.css';

/** What a peek needs: where to read code, how to follow a name, and how to really go there. */
export interface PeekContext {
  project: string;
  revision: string | undefined;
  resolve: ResolveDeclaration;
  open: (frame: PeekFrame) => void;
  /** Light a node up in the graph while it is peeked; null when the peek closes. */
  highlight: (id: string | null) => void;
}

interface NodeInspectorProps {
  node: RenderNode;
  level: CodeGraphLevel;
  neighbours: Neighbours | undefined;
  nodesById: Map<string, RenderNode>;
  /** Nodes in view, to place the node's rank among them. */
  nodes: readonly RenderNode[];
  edges: ReadonlyMap<string, EdgeInfo>;
  overlay: { touched: ReadonlySet<string>; blast: ReadonlySet<string> };
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onDrill: (target: NonNullable<ReturnType<typeof drillTarget>>) => void;
  /** Open the node's file in an editor tab; absent for nodes without one. */
  onViewCode?: () => void;
  /** Show the symbol's usages, call and type hierarchy; symbol nodes only. */
  onUsages?: () => void;
  /** Hovering a neighbour peeks at its code; absent, rows only select. */
  peek?: PeekContext;
}

const LIST_MAX = 30;
const TYPE_SHORT = { call: 'calls', dispatch: 'may run', inherit: 'extends', ref: 'refs' } as const;

const baseName = (file: string) => file.slice(file.lastIndexOf('/') + 1);
const dirName = (file: string) => file.slice(0, Math.max(0, file.lastIndexOf('/')));
const frameOf = (n: RenderNode): PeekFrame | null => (n.file
  ? { id: n.id, label: n.label, file: n.file, range: n.startLine !== null ? [n.startLine, n.endLine ?? n.startLine] : null }
  : null);

function NeighbourItem({ row, grouped, onSelect, peek }: {
  row: NeighbourRow;
  grouped: boolean;
  onSelect: (id: string) => void;
  peek: Peek | null;
}) {
  const { node } = row;
  const frame = frameOf(node);
  const where = node.file
    ? `${grouped ? '' : baseName(node.file)}${node.startLine !== null ? `:${node.startLine}` : ''}`
    : node.kind;
  return (
    <button
      type="button"
      className={`${list.row} ${styles.neighbour}`}
      style={grouped ? { '--row-indent': '24px' } as CSSProperties : undefined}
      onClick={() => onSelect(node.id)}
      onMouseEnter={(e) => frame && peek?.enter(frame, e.currentTarget)}
      onMouseLeave={() => peek?.leave()}
      onFocus={(e) => frame && peek?.enter(frame, e.currentTarget)}
      onBlur={() => peek?.leave()}
      title={`${node.id}${row.types.length ? `\n${row.types.map((t) => LINK_LABELS[t]).join(', ')}` : ''}${row.weight > 1 ? ` ×${row.weight}` : ''}`}
    >
      <span className={styles.edgeMarks} aria-hidden="true">
        {row.types.map((t) => <i key={t} style={{ background: LINK_COLORS[t] }} />)}
      </span>
      <Codicon name={symbolIcon(node.kind)} className={`${list.icon} ${styles.symbolIcon}`} />
      <span className={list.label}>{node.label}</span>
      {row.touched && <Codicon name="diff-modified" className={styles.touched} title="Changed on this branch" />}
      {!row.touched && row.blast && <Codicon name="warning" className={styles.blast} title="Calls changed code" />}
      <span className={list.description}>
        {row.types.map((t) => TYPE_SHORT[t]).join(' · ')}{row.types.length ? ' — ' : ''}{where}
      </span>
      {row.weight > 1 && <span className={styles.weight} title={`${row.weight} symbol edges`}>×{row.weight}</span>}
    </button>
  );
}

function NeighbourList({ title, rows, total, onSelect, peek }: {
  title: string;
  rows: NeighbourRow[];
  /** Neighbours counted before the view truncated; shown when more than in view. */
  total?: number;
  onSelect: (id: string) => void;
  peek: Peek | null;
}) {
  const groups = useMemo(() => groupRows(rows.slice(0, LIST_MAX)), [rows]);
  const flagged = rows.filter((r) => r.touched || r.blast).length;
  return (
    <VscodeCollapsible heading={title} description={flagged ? `${flagged} in the diff` : undefined} open>
      <VscodeBadge variant="counter" slot="decorations" title={total && total > rows.length ? `${rows.length} in view of ${total}` : undefined}>
        {total && total > rows.length ? `${rows.length}/${total}` : rows.length}
      </VscodeBadge>
      {rows.length === 0 ? (
        <p className={list.empty}>None in view</p>
      ) : (
        <ul className={list.list}>
          {groups.map((g) => (
            <li key={g.file ?? ''}>
              {g.file !== null && (
                <div className={`${list.row} ${styles.groupHeader}`} title={g.file}>
                  <Codicon name={g.file ? 'file-code' : 'folder'} className={list.icon} />
                  <span className={list.label}>{g.file ? baseName(g.file) : 'Modules'}</span>
                  <span className={list.description}>{g.file ? dirName(g.file) : ''}</span>
                  <VscodeBadge variant="counter">{g.rows.length}</VscodeBadge>
                </div>
              )}
              <ul className={list.list}>
                {g.rows.map((r) => (
                  <li key={r.node.id}>
                    <NeighbourItem row={r} grouped={g.file !== null} onSelect={onSelect} peek={peek} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {rows.length > LIST_MAX && <li className={list.empty}>+{rows.length - LIST_MAX} more</li>}
        </ul>
      )}
    </VscodeCollapsible>
  );
}

export function NodeInspector({
  node, level, neighbours, nodesById, nodes, edges, overlay, onSelect, onFocus, onDrill, onViewCode, onUsages, peek: peekCtx,
}: NodeInspectorProps) {
  const drill = drillTarget(node, level);
  const location = node.file
    ? node.startLine !== null ? `${node.file}:${node.startLine}` : node.file
    : node.id;
  const callers = useMemo(() => neighbourRows(neighbours?.callers, node.id, 'callers', nodesById, edges, overlay), [neighbours, node.id, nodesById, edges, overlay]);
  const deps = useMemo(() => neighbourRows(neighbours?.deps, node.id, 'deps', nodesById, edges, overlay), [neighbours, node.id, nodesById, edges, overlay]);
  const rank = useMemo(() => rankPosition(node.id, nodes), [node.id, nodes]);
  const peek = usePeek(peekCtx?.highlight);
  const touched = overlay.touched.has(node.id);
  const blast = overlay.blast.has(node.id);

  return (
    <div className={styles.inspector} aria-label="Selected node">
      <header className={styles.inspectorHeader}>
        <h3 className={styles.inspectorTitle}>
          <Codicon name={symbolIcon(node.kind)} className={styles.symbolIcon} /> {node.label}
        </h3>
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
          {rank && (
            <>
              <dt>Rank</dt>
              <dd title={`PageRank ${(node.rank * 100).toFixed(1)}% of the top node`}>
                #{rank.position} of {rank.total}
                <span className={styles.meter} aria-hidden="true"><i style={{ width: `${Math.max(2, node.rank * 100)}%` }} /></span>
              </dd>
            </>
          )}
          {node.size > 1 && (<><dt>Symbols</dt><dd>{node.size}</dd></>)}
          {node.loc > 0 && (<><dt>Lines</dt><dd>{node.loc}</dd></>)}
          {node.churn > 0 && (<><dt>Churn</dt><dd>{node.churn} commits</dd></>)}
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

      <NeighbourList title="Used by" rows={callers} total={node.callers} onSelect={onSelect} peek={peekCtx ? peek : null} />
      <NeighbourList title="Depends on" rows={deps} onSelect={onSelect} peek={peekCtx ? peek : null} />
      {peekCtx && (
        <PeekPopover peek={peek} project={peekCtx.project} revision={peekCtx.revision} resolve={peekCtx.resolve} onOpen={peekCtx.open} />
      )}
    </div>
  );
}
