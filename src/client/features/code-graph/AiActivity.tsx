import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import VscodeBadge from '@vscode-elements/react-elements/dist/components/VscodeBadge.js';
import VscodeCollapsible from '@vscode-elements/react-elements/dist/components/VscodeCollapsible.js';
import type { FileActivityDTO, FileOp } from '../../lib/types';
import { formatCost, formatRelativeTime } from '../../lib/format';
import { sessionTurnHref } from '../session-detail/code-graph-link';
import { Codicon } from '../../shell/workbench/codicons';
import list from '../../shell/workbench/list.module.css';
import styles from './Panels.module.css';

const OP_ICONS: Record<FileOp, string> = { read: 'eye', edit: 'edit', write: 'new-file' };
const indent = (px: number) => ({ '--row-indent': `${px}px` }) as CSSProperties;
const basename = (file: string) => file.slice(file.lastIndexOf('/') + 1);

/** Which turns of the loaded session read or changed this code; a row goes back to that turn. */
export function AiActivity({ sessionId, files, onOpen }: {
  sessionId: string;
  files: FileActivityDTO[];
  /** Open a file in the editor (shown when several files are listed, as for a module). */
  onOpen: (file: string) => void;
}) {
  const navigate = useNavigate();
  if (files.length === 0) return null;
  const several = files.length > 1;
  return (
    <VscodeCollapsible heading="AI activity" description={`${files.length} file${several ? 's' : ''}`} open>
      <div className={list.list} role="tree" aria-label="AI activity">
        {files.map((f) => (
          <div key={f.file} role="group">
            {several && (
              <div className={list.row} role="treeitem" tabIndex={0} title={f.file} style={indent(8)}
                onClick={() => onOpen(f.file)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(f.file); }}
              >
                <Codicon name="file-code" className={`${list.icon} ${styles.fileIcon}`} />
                <span className={list.label}>{basename(f.file)}</span>
                <VscodeBadge variant="counter" title={`${f.edits} turn(s) changed it, ${f.reads} read it`}>{f.edits + f.reads}</VscodeBadge>
              </div>
            )}
            {f.turns.map((t) => {
              const go = () => navigate(sessionTurnHref(sessionId, t.eventId));
              return (
                <div key={t.eventId} className={list.row} role="treeitem" tabIndex={0} style={indent(several ? 24 : 8)}
                  title={`Open turn ${t.eventId} in the session`}
                  onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
                >
                  {t.ops.map((op) => <Codicon key={op} name={OP_ICONS[op]} className={list.icon} title={op} />)}
                  <span className={list.label}>{t.ops.join(' + ')}</span>
                  <span className={list.description}>
                    {t.timestamp ? formatRelativeTime(t.timestamp) : `turn ${t.eventId}`} · {formatCost(t.costUsd)}
                  </span>
                  {t.toolErrors > 0 && (
                    <span className={styles.removed} title={`${t.toolErrors} tool error(s) in this turn`}>
                      <Codicon name="error" /> {t.toolErrors}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </VscodeCollapsible>
  );
}
