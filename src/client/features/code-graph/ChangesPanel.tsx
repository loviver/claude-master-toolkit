import { useState, type CSSProperties } from 'react';
import VscodeCheckbox from '@vscode-elements/react-elements/dist/components/VscodeCheckbox.js';
import VscodeCollapsible from '@vscode-elements/react-elements/dist/components/VscodeCollapsible.js';
import VscodeBadge from '@vscode-elements/react-elements/dist/components/VscodeBadge.js';
import type { CodeGraphChangeDTO, CodeGraphRiskDTO } from '../../lib/types';
import { parseQualifiedId } from '../../../shared/indexer/ids';
import { Codicon } from './workbench/codicons';
import { Placeholder } from './workbench/Workbench';
import list from './workbench/list.module.css';
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
}

const CALLERS_MAX = 20;
const basename = (file: string) => file.slice(file.lastIndexOf('/') + 1);

function ChangeRow({ change, onOpen, onImpact }: { change: CodeGraphChangeDTO } & Pick<ChangesPanelProps, 'onOpen' | 'onImpact'>) {
  const [open, setOpen] = useState(false);
  const n = change.callers.length;
  return (
    <li>
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={n > 0 ? open : undefined}
        className={list.row}
        title={`${change.file}:${change.startLine}`}
        onClick={() => onOpen(change.file, [change.startLine, change.endLine], change.id)}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpen(change.file, [change.startLine, change.endLine], change.id); }}
      >
        <button
          type="button"
          className={list.twistie}
          aria-label={open ? 'Hide callers' : 'Show callers'}
          disabled={n === 0}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        >
          {n > 0 && <Codicon name={open ? 'chevron-down' : 'chevron-right'} />}
        </button>
        <Codicon name="symbol-method" className={`${list.icon} ${styles.symbolIcon}`} />
        <span className={list.label}>{change.symbol}</span>
        <span className={list.description}>{basename(change.file)}</span>
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
        <VscodeBadge variant="counter" title={`${n} untouched caller${n === 1 ? '' : 's'} depend on this`}>{n}</VscodeBadge>
      </div>
      {open && (
        <ul className={list.list} role="group">
          {change.callers.slice(0, CALLERS_MAX).map((id) => {
            const at = parseQualifiedId(id) ?? { file: '', symbol: id };
            return (
              <li key={id}>
                <button
                  type="button"
                  className={list.row}
                  style={{ '--row-indent': '38px' } as CSSProperties}
                  onClick={() => onOpen(at.file, null, id)}
                  title={id}
                >
                  <Codicon name="arrow-small-left" className={list.icon} />
                  <span className={list.label}>{at.symbol}</span>
                  <span className={list.description}>{at.file}</span>
                </button>
              </li>
            );
          })}
          {n > CALLERS_MAX && <li className={list.empty}>+{n - CALLERS_MAX} more</li>}
        </ul>
      )}
    </li>
  );
}

/** Source-control-like view of the diff: changed symbols ranked by who depends on them. */
export function ChangesPanel({ risk, error, worktree, onWorktree, onOpen, onImpact }: ChangesPanelProps) {
  const callersAtRisk = risk ? new Set(risk.changes.flatMap((c) => c.callers)).size : 0;
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

          <VscodeCollapsible heading="Changed symbols" description="by callers" open>
            <VscodeBadge variant="counter" slot="decorations">{risk.changes.length}</VscodeBadge>
            {risk.changes.length === 0 ? (
              <p className={list.empty}>The diff touches no indexed symbol.</p>
            ) : (
              <ul className={list.list} role="tree" aria-label="Changed symbols">
                {risk.changes.map((c) => <ChangeRow key={c.id} change={c} onOpen={onOpen} onImpact={onImpact} />)}
              </ul>
            )}
          </VscodeCollapsible>

          <VscodeCollapsible heading="Changed files" open>
            <VscodeBadge variant="counter" slot="decorations">{risk.files.length}</VscodeBadge>
            <ul className={list.list} aria-label="Changed files">
              {risk.files.map((f) => (
                <li key={f.file}>
                  <button
                    type="button"
                    className={list.row}
                    onClick={() => onOpen(f.file, f.ranges[0] ? [f.ranges[0][0], f.ranges[0][1]] : null, null)}
                    title={f.file}
                  >
                    <span className={list.twistie} />
                    <Codicon name="file-code" className={`${list.icon} ${styles.fileIcon}`} />
                    <span className={`${list.label} ${list.modified}`}>{basename(f.file)}</span>
                    <span className={list.description}>{f.file}</span>
                    <span className={`${list.decoration} ${styles.added}`}>+{f.added}</span>
                  </button>
                </li>
              ))}
            </ul>
          </VscodeCollapsible>
        </>
      )}
    </>
  );
}
