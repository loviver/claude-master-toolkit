import { useState } from 'react';
import { ChevronDown, ChevronRight, Crosshair, GitBranch } from 'lucide-react';
import { Badge, EmptyState, Skeleton } from '../../components/ui';
import type { CodeGraphChangeDTO, CodeGraphRiskDTO } from '../../lib/types';
import { parseQualifiedId } from '../../../shared/indexer/ids';
import styles from './CodeGraph.module.css';

interface ChangesPanelProps {
  risk: CodeGraphRiskDTO | undefined;
  isLoading: boolean;
  error: string | null;
  worktree: boolean;
  onWorktree: (on: boolean) => void;
  /** Open a file in the code viewer, optionally at a line span. */
  onOpen: (file: string, range: [number, number] | null, symbolId: string | null) => void;
  /** Switch the graph to the impact view of a symbol. */
  onImpact: (symbolId: string) => void;
}

const TIER_VARIANT: Record<string, 'success' | 'warning' | 'error'> = {
  DIRECT: 'success', GUARDED: 'warning', DELEGATE: 'error',
};
const CALLERS_MAX = 20;

function ChangeRow({ change, onOpen, onImpact }: { change: CodeGraphChangeDTO } & Pick<ChangesPanelProps, 'onOpen' | 'onImpact'>) {
  const [open, setOpen] = useState(false);
  const n = change.callers.length;
  return (
    <li className={styles.changeItem}>
      <div className={styles.changeRow}>
        <button
          type="button"
          className={styles.changeToggle}
          aria-expanded={open}
          disabled={n === 0}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Hide callers' : 'Show callers'}
        >
          {n > 0 && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        </button>
        <button
          type="button"
          className={styles.changeName}
          onClick={() => onOpen(change.file, [change.startLine, change.endLine], change.id)}
          title={`${change.file}:${change.startLine}`}
        >
          {change.symbol}
          <span>{change.file}</span>
        </button>
        <span className={n > 0 ? styles.callerCount : styles.callerCountNone} title={`${n} untouched caller${n === 1 ? '' : 's'} depend on this`}>
          {n}
        </span>
        <button type="button" className={styles.changeImpact} onClick={() => onImpact(change.id)} title="Impact view in the graph">
          <Crosshair size={12} />
        </button>
      </div>
      {open && (
        <ul className={styles.callerList}>
          {change.callers.slice(0, CALLERS_MAX).map((id) => {
            const at = parseQualifiedId(id) ?? { file: '', symbol: id };
            return (
              <li key={id}>
                <button type="button" className={styles.callerItem} onClick={() => onOpen(at.file, null, id)} title={id}>
                  {at.symbol}<span>{at.file}</span>
                </button>
              </li>
            );
          })}
          {n > CALLERS_MAX && <li className={styles.muted}>+{n - CALLERS_MAX} more</li>}
        </ul>
      )}
    </li>
  );
}

export function ChangesPanel({ risk, isLoading, error, worktree, onWorktree, onOpen, onImpact }: ChangesPanelProps) {
  return (
    <div className={styles.changes}>
      <label className={styles.worktreeToggle}>
        <input type="checkbox" checked={worktree} onChange={(e) => onWorktree(e.target.checked)} />
        Include uncommitted edits
      </label>

      {error ? (
        <EmptyState icon={GitBranch} title="Changes unavailable" description={error} />
      ) : isLoading || !risk ? (
        <Skeleton height={120} radius="sm" />
      ) : risk.files.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="No changes"
          description={`Nothing differs from ${risk.base}${worktree ? ' (working tree included)' : ''}.`}
        />
      ) : (
        <>
          <div className={styles.changeSummary}>
            <Badge variant={TIER_VARIANT[risk.tier] ?? 'warning'}>{risk.tier}</Badge>
            <span>
              vs <code>{risk.base}</code> · score {risk.score.toFixed(2)}
            </span>
          </div>
          <p className={styles.changeFacts}>
            {risk.files.length} file{risk.files.length === 1 ? '' : 's'} · {risk.changes.length} symbol
            {risk.changes.length === 1 ? '' : 's'} · {new Set(risk.changes.flatMap((c) => c.callers)).size} callers at risk
          </p>

          <h4 className={styles.inspectorHeading}>Changed symbols <span>by callers</span></h4>
          {risk.changes.length === 0 ? (
            <p className={styles.muted}>The diff touches no indexed symbol.</p>
          ) : (
            <ul className={styles.changeList}>
              {risk.changes.map((c) => <ChangeRow key={c.id} change={c} onOpen={onOpen} onImpact={onImpact} />)}
            </ul>
          )}

          <h4 className={styles.inspectorHeading}>Changed files <span>{risk.files.length}</span></h4>
          <ul className={styles.changeList}>
            {risk.files.map((f) => (
              <li key={f.file}>
                <button
                  type="button"
                  className={styles.callerItem}
                  onClick={() => onOpen(f.file, f.ranges[0] ? [f.ranges[0][0], f.ranges[0][1]] : null, null)}
                  title={f.file}
                >
                  {f.file}<span>+{f.added}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
