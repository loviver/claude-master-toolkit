import { Link } from 'react-router-dom';
import { useSessions } from '../../hooks/queries/useSessions';
import { formatCompactCost, formatProjectName, formatRelativeTime } from '../../lib/format';
import { Codicon } from '../../shell/workbench/codicons';
import { Pane, Placeholder } from '../../shell/workbench/Workbench';
import list from '../../shell/workbench/list.module.css';

const RECENT_LIMIT = 100;

/** Recent sessions as an explorer list, to hop between them without leaving the detail. */
export function SessionsSideBar({ activeId }: { activeId: string | undefined }) {
  const { data, isLoading, isError } = useSessions({ limit: RECENT_LIMIT });
  return (
    <Pane
      title="Sessions"
      loading={isLoading}
      actions={<Link to="/sessions" className={list.action} title="Open the full sessions table" aria-label="Open the full sessions table"><Codicon name="list-flat" /></Link>}
    >
      {isError ? (
        <Placeholder icon="error" title="Sessions unavailable" />
      ) : (
        <ul className={list.list}>
          {(data ?? []).map((s) => (
            <li key={s.id}>
              <Link
                to={`/sessions/${s.id}`}
                className={list.row}
                aria-current={s.id === activeId ? 'true' : undefined}
                title={`${s.projectPath}\n${s.primaryModel} · ${s.turnCount} turns`}
              >
                <Codicon name="comment-discussion" className={list.icon} />
                <span className={list.label}>{formatProjectName(s.projectPath)}</span>
                <span className={list.description}>{formatRelativeTime(s.lastActiveAt)}</span>
                <span className={list.decoration}>{formatCompactCost(s.costUsd)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Pane>
  );
}
