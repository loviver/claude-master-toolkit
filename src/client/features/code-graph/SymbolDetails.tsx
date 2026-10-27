import type { CSSProperties, ReactNode } from 'react';
import VscodeBadge from '@vscode-elements/react-elements/dist/components/VscodeBadge.js';
import VscodeButton from '@vscode-elements/react-elements/dist/components/VscodeButton.js';
import VscodeCollapsible from '@vscode-elements/react-elements/dist/components/VscodeCollapsible.js';
import VscodeToolbarButton from '@vscode-elements/react-elements/dist/components/VscodeToolbarButton.js';
import { useCodeGraphSymbol } from '../../hooks/queries/useCodeGraph';
import type { CodeGraphSymbolRefDTO, CodeGraphUsageDTO } from '../../lib/types';
import { symbolIcon } from './nav-model';
import { Codicon } from './workbench/codicons';
import { Placeholder, ProgressLine } from './workbench/Workbench';
import list from './workbench/list.module.css';
import styles from './Panels.module.css';

interface SymbolDetailsProps {
  project: string;
  id: string;
  revision: string | undefined;
  /** Open a symbol (its declaration, or `line` inside it). */
  onOpen: (symbol: CodeGraphSymbolRefDTO, line?: number) => void;
  /** Inspect another symbol here, as IntelliJ's hierarchy views re-root on a node. */
  onInspect: (symbol: CodeGraphSymbolRefDTO) => void;
  onImpact: (id: string) => void;
  errorMessage: (err: unknown) => string;
}

const LIST_MAX = 100;
const indent = (px: number) => ({ '--row-indent': `${px}px` }) as CSSProperties;

function SymbolRow({ symbol, onOpen, onInspect, depth = 0, note }: {
  symbol: CodeGraphSymbolRefDTO;
  onOpen: () => void;
  onInspect?: () => void;
  depth?: number;
  note?: string;
}) {
  return (
    <div className={list.row} style={indent(8 + depth * 16)} role="treeitem" tabIndex={0} title={symbol.id}
      onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      <Codicon name={symbolIcon(symbol.kind)} className={`${list.icon} ${styles.symbolIcon}`} />
      <span className={list.label}>{symbol.symbol}</span>
      <span className={list.description}>{note ?? `${symbol.file}:${symbol.startLine}`}</span>
      {onInspect && (
        <span className={list.actions}>
          <button type="button" className={list.action} title="Show its usages" onClick={(e) => { e.stopPropagation(); onInspect(); }}>
            <Codicon name="references" />
          </button>
        </span>
      )}
    </div>
  );
}

/** A collapsible group of symbols; hidden when empty unless `always` (usages say "none" instead). */
function Section({ title, items, always, empty, render }: {
  title: string;
  items: readonly CodeGraphSymbolRefDTO[];
  always?: boolean;
  empty?: string;
  render: (s: CodeGraphSymbolRefDTO) => ReactNode;
}) {
  if (items.length === 0 && !always) return null;
  return (
    <VscodeCollapsible heading={title} open>
      <VscodeBadge variant="counter" slot="decorations">{items.length}</VscodeBadge>
      {items.length === 0 ? (
        <p className={list.empty}>{empty}</p>
      ) : (
        <ul className={list.list} role="tree" aria-label={title}>
          {items.slice(0, LIST_MAX).map((s) => <li key={s.id}>{render(s)}</li>)}
          {items.length > LIST_MAX && <li className={list.empty}>+{items.length - LIST_MAX} more</li>}
        </ul>
      )}
    </VscodeCollapsible>
  );
}

/** A caller, then one row per call site: IntelliJ's Find Usages grouping. */
function UsageRows({ usage, onOpen, onInspect }: {
  usage: CodeGraphUsageDTO;
  onOpen: (symbol: CodeGraphSymbolRefDTO, line?: number) => void;
  onInspect: (symbol: CodeGraphSymbolRefDTO) => void;
}) {
  return (
    <>
      <SymbolRow
        symbol={usage}
        note={`${usage.file}${usage.dispatch ? ' · via override' : ''}`}
        onOpen={() => onOpen(usage, usage.lines[0])}
        onInspect={() => onInspect(usage)}
      />
      {usage.lines.length > 1 && (
        <ul className={list.list} role="group">
          {usage.lines.map((line) => (
            <li key={line}>
              <button type="button" className={list.row} style={indent(40)} onClick={() => onOpen(usage, line)}>
                <Codicon name="symbol-reference" className={list.icon} />
                <span className={list.label}>line {line}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One symbol and everything around it: usages, calls, type hierarchy and members. */
export function SymbolDetails({ project, id, revision, onOpen, onInspect, onImpact, errorMessage }: SymbolDetailsProps) {
  const query = useCodeGraphSymbol(project, id, revision);
  const s = query.data;
  if (query.isError) return <Placeholder icon="error" title="Symbol unavailable">{errorMessage(query.error)}</Placeholder>;
  if (!s) return <ProgressLine />;

  const location = `${s.file}:${s.startLine}`;
  const plain = (r: CodeGraphSymbolRefDTO) => <SymbolRow symbol={r} onOpen={() => onOpen(r)} onInspect={() => onInspect(r)} />;
  return (
    <div aria-label="Symbol">
      {query.isFetching && <ProgressLine />}
      <header className={styles.inspectorHeader}>
        <h3 className={styles.inspectorTitle}>
          <Codicon name={symbolIcon(s.kind)} className={styles.symbolIcon} /> {s.symbol}
        </h3>
        <div className={styles.badges}>
          <VscodeBadge>{s.kind}</VscodeBadge>
          {s.exported && <VscodeBadge>exported</VscodeBadge>}
        </div>
        <div className={styles.location}>
          <span title={location}>{location}</span>
          <VscodeToolbarButton icon="copy" label="Copy location" onClick={() => void navigator.clipboard?.writeText(location)} />
        </div>
        {s.signature && <pre className={styles.signature}>{s.signature}</pre>}
        <dl className={styles.facts}>
          <dt>Lines</dt><dd>{s.startLine}–{s.endLine} ({s.endLine - s.startLine + 1})</dd>
          <dt>Used by</dt><dd>{s.callers.length + s.referrers.length}</dd>
          <dt>Uses</dt><dd>{s.callees.length + s.references.length}</dd>
        </dl>
        <div className={styles.actionsRow}>
          <VscodeButton icon="go-to-file" onClick={() => onOpen(s)}>Declaration</VscodeButton>
          <VscodeButton secondary icon="target" onClick={() => onImpact(s.id)}>Impact view</VscodeButton>
        </div>
      </header>

      <Section
        title="Usages"
        items={s.callers}
        always
        empty="No calls to it in the index."
        render={(u) => <UsageRows usage={u as CodeGraphUsageDTO} onOpen={onOpen} onInspect={onInspect} />}
      />
      <Section title="Referenced by" items={s.referrers} render={plain} />
      <Section title="Calls" items={s.callees} render={plain} />
      <Section title="Uses types and values" items={s.references} render={plain} />
      <Section title="Supertypes" items={s.supertypes} render={plain} />
      <Section title="Subtypes and implementations" items={s.subtypes} render={plain} />
      <Section title="Members" items={s.members} render={plain} />
    </div>
  );
}
