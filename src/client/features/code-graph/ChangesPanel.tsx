import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import VscodeCheckbox from '@vscode-elements/react-elements/dist/components/VscodeCheckbox.js';
import VscodeBadge from '@vscode-elements/react-elements/dist/components/VscodeBadge.js';
import type { CodeGraphChangeDTO, CodeGraphRiskDTO } from '../../lib/types';
import { activeChange, changesTree, formatSpans, impactBadge, type ChangedFileNode } from './changes-model';
import { parseQualifiedId } from '../../../shared/indexer/ids';
import { Codicon } from '../../shell/workbench/codicons';
import { Placeholder } from '../../shell/workbench/Workbench';
import { revealRow } from '../../shell/workbench/reveal';
import list from '../../shell/workbench/list.module.css';
import styles from './Panels.module.css';

interface ChangesPanelProps {
  risk: CodeGraphRiskDTO | undefined;
  error: string | null;
  worktree: boolean;
  onWorktree: (on: boolean) => void;
  /** Open a file in the code viewer, optionally at a line span. */
  onOpen: (file: string, range: [number, number] | null, symbolId: string | null) => void;
  /** Switch the graph to the impact view of a symbol. */
  onImpact: (symbolId: string) => void;
  /** What is being viewed (open tab, selected node): its row is highlighted and scrolled into view. */
  activeFile: string | null;
  activeSymbol: string | null;
}

const LINKS_MAX = 20;
const basename = (file: string) => file.slice(file.lastIndexOf('/') + 1);
const dirname = (file: string) => file.slice(0, Math.max(0, file.lastIndexOf('/')));
const indent = (px: number) => ({ '--row-indent': `${px}px` }) as CSSProperties;

type Open = Pick<ChangesPanelProps, 'onOpen' | 'onImpact'>;

/** `+a −r` as a source-control decoration. */
function LineCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className={list.decoration}>
      {added > 0 && <span className={styles.added}>+{added}</span>}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && <span className={styles.removed}>−{removed}</span>}
    </span>
  );
}

function Twistie({ open, enabled, label, onToggle }: { open: boolean; enabled: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={list.twistie}
      aria-label={label}
      disabled={!enabled}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      {enabled && <Codicon name={open ? 'chevron-down' : 'chevron-right'} />}
    </button>
  );
}

/** One direction of a symbol's links: ↑ who calls it (impact) or ↓ what it uses. */
function LinkGroup({ icon, label, ids, onOpen }: { icon: string; label: string; ids: string[]; onOpen: Open['onOpen'] }) {
  const [open, setOpen] = useState(icon === 'arrow-small-up');
  if (ids.length === 0) return null;
  return (
    <li>
      <div role="treeitem" tabIndex={0} aria-expanded={open} className={list.row} style={indent(40)} onClick={() => setOpen((v) => !v)}>
        <Twistie open={open} enabled label={open ? `Hide ${label}` : `Show ${label}`} onToggle={() => setOpen((v) => !v)} />
        <Codicon name={icon} className={list.icon} />
        <span className={list.label}>{label}</span>
        <VscodeBadge variant="counter">{ids.length}</VscodeBadge>
      </div>
      {open && (
        <ul className={list.list} role="group">
          {ids.slice(0, LINKS_MAX).map((id) => {
            const at = parseQualifiedId(id) ?? { file: '', symbol: id };
            return (
              <li key={id}>
                <button type="button" className={list.row} style={indent(72)} onClick={() => onOpen(at.file, null, id)} title={id}>
                  <span className={list.label}>{at.symbol}</span>
                  <span className={list.description}>{at.file}</span>
                </button>
              </li>
            );
          })}
          {ids.length > LINKS_MAX && <li className={list.empty}>+{ids.length - LINKS_MAX} more</li>}
        </ul>
      )}
    </li>
  );
}

function SymbolRow({ change, active, onOpen, onImpact }: { change: CodeGraphChangeDTO; active: boolean } & Open) {
  const [open, setOpen] = useState(false);
  const n = change.callers.length;
  const expandable = n + change.deps.length > 0;
  const first = change.ranges[0] ?? [change.startLine, change.endLine];
  const go = () => onOpen(change.file, [first[0], first[1]], change.id);
  return (
    <li>
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={expandable ? open : undefined}
        aria-current={active ? 'true' : undefined}
        ref={active ? revealRow : undefined}
        className={list.row}
        style={indent(24)}
        title={`${change.symbol} · ${change.file}:${change.startLine}–${change.endLine}${change.exported ? ' · exported' : ''}`}
        onClick={go}
        onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
      >
        <Twistie open={open} enabled={expandable} label={open ? 'Hide links' : 'Show callers and deps'} onToggle={() => setOpen((v) => !v)} />
        <Codicon name={change.exported ? 'symbol-interface' : 'symbol-method'} className={`${list.icon} ${styles.symbolIcon}`} />
        <span className={list.label}>{change.symbol}</span>
        <span className={list.description}>{formatSpans(change.ranges)}</span>
        <span className={list.actions}>
          <button
            type="button"
            className={list.action}
            title="Impact view in the graph"
            aria-label="Impact view in the graph"
            onClick={(e) => { e.stopPropagation(); onImpact(change.id); }}
          >
            <Codicon name="target" />
          </button>
        </span>
        <LineCounts added={change.added} removed={change.removed} />
        <VscodeBadge variant="counter" title={`${n} untouched caller${n === 1 ? '' : 's'} depend on this`}>{n}</VscodeBadge>
      </div>
      {open && (
        <ul className={list.list} role="group">
          <LinkGroup icon="arrow-small-up" label="Called by (impact)" ids={change.callers} onOpen={onOpen} />
          <LinkGroup icon="arrow-small-down" label="Uses" ids={change.deps} onOpen={onOpen} />
        </ul>
      )}
    </li>
  );
}

function FileRow({ node, active, onOpen, onImpact }: { node: ChangedFileNode; active: { symbol: string | null } | null } & Open) {
  const [open, setOpen] = useState(true);
  // A viewed symbol inside a collapsed file opens it, so its row can be revealed.
  useEffect(() => { if (active?.symbol) setOpen(true); }, [active?.symbol]);
  const expandable = node.symbols.length > 0 || node.outside.length > 0;
  const go = () => onOpen(node.file, null, null);
  return (
    <li>
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={expandable ? open : undefined}
        aria-current={active && !active.symbol ? 'true' : undefined}
        ref={active && !active.symbol ? revealRow : undefined}
        className={list.row}
        title={node.file}
        onClick={go}
        onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
      >
        <Twistie open={open} enabled={expandable} label={open ? 'Collapse' : 'Expand'} onToggle={() => setOpen((v) => !v)} />
        <Codicon name="file-code" className={`${list.icon} ${styles.fileIcon}`} />
        <span className={`${list.label} ${list.modified}`}>{basename(node.file)}</span>
        <span className={list.description}>{dirname(node.file)}</span>
        <LineCounts added={node.added} removed={node.removed} />
        <VscodeBadge
          variant="counter"
          title={node.symbols.length === 0
            ? 'Impact unknown: no indexed symbol covers these changes (new or unindexed file)'
            : `${node.callers} untouched caller${node.callers === 1 ? '' : 's'} of this file's changes`}
        >
          {impactBadge(node)}
        </VscodeBadge>
      </div>
      {open && (
        <ul className={list.list} role="group">
          {node.symbols.map((c) => <SymbolRow key={c.id} change={c} active={active?.symbol === c.id} onOpen={onOpen} onImpact={onImpact} />)}
          {node.outside.length > 0 && (
            <li>
              <button
                type="button"
                className={list.row}
                style={indent(24)}
                title="Changed lines no indexed symbol covers: imports, top-level code, comments"
                onClick={() => onOpen(node.file, [node.outside[0][0], node.outside[0][1]], null)}
              >
                <span className={list.twistie} />
                <Codicon name="whitespace" className={list.icon} />
                <span className={`${list.label} ${styles.outside}`}>outside symbols</span>
                <span className={list.description}>{formatSpans(node.outside)}</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** Source-control-like view of the diff: file → changed symbol → its lines, ↑ callers and ↓ deps. */
export function ChangesPanel({ risk, error, worktree, onWorktree, onOpen, onImpact, activeFile, activeSymbol }: ChangesPanelProps) {
  const callersAtRisk = risk ? new Set(risk.changes.flatMap((c) => c.callers)).size : 0;
  const tree = useMemo(() => (risk ? changesTree(risk.changes, risk.files) : []), [risk]);
  const active = activeChange(tree, activeFile, activeSymbol);
  return (
    <>
      <div className={styles.filter}>
        <VscodeCheckbox
          label="Include uncommitted edits"
          checked={worktree}
          onChange={(e) => onWorktree((e.target as HTMLInputElement).checked)}
        />
      </div>

      {error ? (
        <Placeholder icon="error" title="Changes unavailable">{error}</Placeholder>
      ) : !risk ? null : risk.files.length === 0 ? (
        <Placeholder icon="check" title="No changes">
          Nothing differs from <code>{risk.base}</code>{worktree ? ' (working tree included)' : ''}.
        </Placeholder>
      ) : (
        <>
          <p className={styles.summary}>
            <span className={styles[`tier${risk.tier}`]}>{risk.tier}</span>
            {' '}vs <code>{risk.base}</code> · score {risk.score.toFixed(2)}
            <br />
            {risk.files.length} file{risk.files.length === 1 ? '' : 's'} · {risk.changes.length} symbol
            {risk.changes.length === 1 ? '' : 's'} · {callersAtRisk} callers at risk
          </p>

          <ul className={list.list} role="tree" aria-label="Changes">
            {tree.map((f) => <FileRow key={f.file} node={f} active={active?.file === f.file ? active : null} onOpen={onOpen} onImpact={onImpact} />)}
          </ul>
        </>
      )}
    </>
  );
}
