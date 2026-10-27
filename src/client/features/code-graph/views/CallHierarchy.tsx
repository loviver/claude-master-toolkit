import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { codeGraphSymbolQuery } from '../../../hooks/queries/useCodeGraph';
import type { CodeGraphSymbolRefDTO } from '../../../lib/types';
import { Placeholder } from '../workbench/Workbench';
import { symbolIcon } from '../nav-model';
import { Codicon } from '../workbench/codicons';
import { callTreeChildren, isRecursive, type CallDirection } from './call-tree-model';
import styles from './Views.module.css';

interface Common {
  project: string;
  revision: string | undefined;
  direction: CallDirection;
  onOpen: (s: CodeGraphSymbolRefDTO, line?: number) => void;
  errorMessage: (e: unknown) => string;
}

function Row({ id, label, ref_, line, path, depth, ...c }: Common & {
  id: string;
  label: string;
  ref_: CodeGraphSymbolRefDTO | null;
  line?: number;
  path: string[];
  depth: number;
}) {
  const recursive = isRecursive(path, id);
  const [open, setOpen] = useState(depth === 0);
  const sym = useQuery({ ...codeGraphSymbolQuery(c.project, id, c.revision), enabled: open && !recursive });
  const kids = sym.data ? callTreeChildren(sym.data, c.direction) : [];
  const target = ref_ ?? sym.data ?? null;
  return (
    <>
      <div className={styles.row} style={{ paddingLeft: depth * 16 }}>
        <button type="button" className={styles.twistie} disabled={recursive} onClick={() => setOpen((v) => !v)} aria-label={open ? 'Collapse' : 'Expand'}>
          <Codicon name={recursive ? 'refresh' : open ? 'chevron-down' : 'chevron-right'} />
        </button>
        <Codicon name={symbolIcon(target?.kind ?? 'function')} />
        <button type="button" className={styles.sym} onClick={() => target && c.onOpen(target, line)}>{label}</button>
        {target && <span className={styles.where}>{target.file}:{line ?? target.startLine}</span>}
        {recursive && <span className={styles.recursive}>recursive</span>}
        {open && sym.isLoading && <span className={styles.where}>…</span>}
        {open && sym.isError && <span className={styles.recursive}>{c.errorMessage(sym.error)}</span>}
      </div>
      {open && !recursive && kids.map((k) => (
        <Row key={`${k.id}:${k.lines[0] ?? ''}`} {...c} id={k.id} label={k.symbol} ref_={k} line={k.lines[0]} path={[...path, id]} depth={depth + 1} />
      ))}
      {open && !recursive && sym.data && kids.length === 0 && (
        <div className={styles.row} style={{ paddingLeft: (depth + 1) * 16 + 20 }}>
          <span className={styles.where}>{c.direction === 'incoming' ? 'no callers in the index' : 'calls nothing indexed'}</span>
        </div>
      )}
    </>
  );
}

/** IntelliJ's call hierarchy: expand callers or callees as deep as you like, recursion cut. */
export function CallHierarchy({ rootId, ...c }: Omit<Common, 'direction'> & { rootId: string | null }) {
  const [direction, setDirection] = useState<CallDirection>('incoming');
  if (!rootId) {
    return <Placeholder icon="call-incoming" title="No symbol selected">
      Switch to the Symbols level and click a node, or Ctrl+click a name in the code, to see who calls it and what it calls.
    </Placeholder>;
  }
  const name = rootId.slice(rootId.indexOf('::') + 2);
  return (
    <div className={styles.tree}>
      <div className={styles.treeTools}>
        {(['incoming', 'outgoing'] as const).map((d) => (
          <button key={d} type="button" className={styles.crumbBtn} aria-pressed={direction === d} style={{ fontWeight: direction === d ? 700 : 400 }} onClick={() => setDirection(d)}>
            <Codicon name={d === 'incoming' ? 'call-incoming' : 'call-outgoing'} /> {d === 'incoming' ? 'Callers' : 'Callees'}
          </button>
        ))}
      </div>
      <Row key={`${rootId}:${direction}`} {...c} direction={direction} id={rootId} label={name} ref_={null} path={[]} depth={0} />
    </div>
  );
}

