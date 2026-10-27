import { useMemo, type CSSProperties } from 'react';
import type { CodeGraphOutlineDTO } from '../../lib/types';
import { memberName, outlineTree, symbolIcon, type OutlineNode } from './nav-model';
import { Codicon } from './workbench/codicons';
import { Placeholder } from './workbench/Workbench';
import list from './workbench/list.module.css';
import styles from './Panels.module.css';

interface StructureViewProps {
  outline: readonly CodeGraphOutlineDTO[];
  /** The symbol shown in the symbol view: marked as current. */
  activeId: string | null;
  onSelect: (symbol: CodeGraphOutlineDTO) => void;
}

function Rows({ nodes, depth, activeId, onSelect }: { nodes: OutlineNode[]; depth: number } & Omit<StructureViewProps, 'outline'>) {
  return (
    <ul className={list.list} role={depth === 0 ? 'tree' : 'group'} aria-label={depth === 0 ? 'Structure' : undefined}>
      {nodes.map(({ item, children }) => (
        <li key={item.id}>
          <button
            type="button"
            className={list.row}
            style={{ '--row-indent': `${8 + depth * 16}px` } as CSSProperties}
            aria-current={item.id === activeId}
            onClick={() => onSelect(item)}
            title={`${item.symbol} · ${item.kind} · L${item.startLine}`}
          >
            <Codicon name={symbolIcon(item.kind)} className={`${list.icon} ${styles.symbolIcon}`} />
            <span className={list.label}>{memberName(item.symbol)}</span>
            <span className={list.description}>L{item.startLine}</span>
          </button>
          {children.length > 0 && <Rows nodes={children} depth={depth + 1} activeId={activeId} onSelect={onSelect} />}
        </li>
      ))}
    </ul>
  );
}

/** IntelliJ's Structure tool window: the open file's symbols, nested by where they are declared. */
export function StructureView({ outline, activeId, onSelect }: StructureViewProps) {
  const tree = useMemo(() => outlineTree(outline), [outline]);
  if (tree.length === 0) {
    return <Placeholder icon="symbol-misc" title="No symbols">The index has no symbols for this file.</Placeholder>;
  }
  return <Rows nodes={tree} depth={0} activeId={activeId} onSelect={onSelect} />;
}
