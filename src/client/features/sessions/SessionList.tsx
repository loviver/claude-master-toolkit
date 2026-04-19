import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListOrdered, Search, Inbox, SlidersHorizontal } from 'lucide-react';
import { useSessions, useSessionsListLive } from '../../hooks/queries/useSessions';
import { useProjects } from '../../hooks/queries/useStats';
import { useFilters } from '../../lib/filters';
import {
  PageHeader, FilterBar, Card, DataTable, Badge, modelKeyBadgeVariant, phaseBadgeVariant,
  EmptyState, Skeleton, Icon,
  type DataTableColumn,
} from '../../components/ui';
import {
  formatTokens, formatCost, formatRelativeTime, formatProjectName, shortModel, formatDuration, formatPercent,
} from '../../lib/format';
import type { SessionSummary } from '../../lib/types';
import styles from './SessionList.module.css';

type ColKey =
  | 'project' | 'branch' | 'model' | 'phase' | 'turns' | 'side' | 'tools' | 'errors'
  | 'thinking' | 'cache' | 'input' | 'output' | 'cost' | 'duration' | 'active';

const DEFAULT_VISIBLE: ColKey[] = ['project', 'branch', 'model', 'phase', 'turns', 'tools', 'errors', 'cost', 'duration', 'active'];
const OPTIONAL: ColKey[] = ['side', 'thinking', 'cache', 'input', 'output'];

const allColumns: DataTableColumn<SessionSummary>[] = [
  {
    key: 'project',
    header: 'Project',
    sortBy: (s) => formatProjectName(s.projectPath),
    render: (s) => (
      <span className={styles.project} title={s.projectPath}>
        {formatProjectName(s.projectPath)}
      </span>
    ),
  },
  {
    key: 'branch',
    header: 'Branch',
    sortBy: (s) => s.gitBranch ?? '',
    render: (s) => <span className={styles.branch}>{s.gitBranch ?? '—'}</span>,
  },
  {
    key: 'model',
    header: 'Model',
    sortBy: (s) => s.primaryModelKey,
    render: (s) => (
      <div className={styles.modelCell}>
        {s.isEmpty ? (
          <Badge variant="default" title="Session with no assistant turns">empty</Badge>
        ) : (
          <Badge variant={modelKeyBadgeVariant(s.primaryModelKey)}>{shortModel(s.primaryModel)}</Badge>
        )}
        {s.models.length > 1 && <span className={styles.mix}>+{s.models.length - 1}</span>}
      </div>
    ),
  },
  {
    key: 'phase',
    header: 'Phase',
    sortBy: (s) => s.dominantPhase,
    render: (s) => <Badge variant={phaseBadgeVariant(s.dominantPhase)}>{s.dominantPhase}</Badge>,
  },
  { key: 'turns', header: 'Turns', align: 'right', sortBy: (s) => s.turnCount, render: (s) => s.turnCount },
  { key: 'side', header: 'Side', align: 'right', tooltip: 'Sidechain turns', sortBy: (s) => s.sidechainTurns, render: (s) => s.sidechainTurns || '—' },
  { key: 'tools', header: 'Tools', align: 'right', sortBy: (s) => s.toolCount, render: (s) => s.toolCount || '—' },
  {
    key: 'errors', header: 'Err', align: 'right', tooltip: 'Tool + API errors',
    sortBy: (s) => (s.toolErrorCount ?? 0) + (s.apiErrorTurns ?? 0),
    render: (s) => {
      const total = (s.toolErrorCount ?? 0) + (s.apiErrorTurns ?? 0);
      if (total === 0) return '—';
      return <span className={styles.errCell} title={`tool: ${s.toolErrorCount ?? 0}, API: ${s.apiErrorTurns ?? 0}`}>{total}</span>;
    },
  },
  { key: 'thinking', header: 'Think', align: 'right', tooltip: 'Turns with thinking', sortBy: (s) => s.thinkingTurns ?? 0, render: (s) => (s.thinkingTurns ? s.thinkingTurns : '—') },
  { key: 'cache', header: 'Cache', align: 'right', tooltip: 'Cache hit %', sortBy: (s) => s.cacheHitPct ?? 0, render: (s) => (s.cacheHitPct != null ? formatPercent(s.cacheHitPct) : '—') },
  { key: 'input', header: 'Input', align: 'right', sortBy: (s) => s.tokens.inputTokens, render: (s) => formatTokens(s.tokens.inputTokens) },
  { key: 'output', header: 'Output', align: 'right', sortBy: (s) => s.tokens.outputTokens, render: (s) => formatTokens(s.tokens.outputTokens) },
  { key: 'cost', header: 'Cost', align: 'right', sortBy: (s) => s.costUsd, render: (s) => <span className={styles.cost}>{formatCost(s.costUsd)}</span> },
  { key: 'duration', header: 'Duration', align: 'right', tooltip: 'First → last turn', sortBy: (s) => s.durationMs ?? 0, render: (s) => (s.durationMs && s.durationMs > 0 ? formatDuration(s.durationMs) : '—') },
  { key: 'active', header: 'Active', sortBy: (s) => s.lastActiveAt, render: (s) => <span className={styles.time}>{formatRelativeTime(s.lastActiveAt)}</span> },
];

export function SessionList() {
  const { filters } = useFilters();
  const { data: projects } = useProjects(filters);
  const [q, setQ] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
  const [visible, setVisible] = useState<Set<ColKey>>(() => new Set(DEFAULT_VISIBLE));
  const [showColPicker, setShowColPicker] = useState(false);
  const { data, isLoading } = useSessions({ ...filters, q: q || undefined, limit: 200 });
  useSessionsListLive();
  const navigate = useNavigate();

  const rows = (data ?? []).filter((s) => !hideEmpty || !s.isEmpty);
  const columns = allColumns.filter((c) => visible.has(c.key as ColKey));

  const toggleCol = (k: ColKey) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  return (
    <div className={styles.page}>
      <PageHeader icon={ListOrdered} title="Sessions" description="Browse and drill into recorded Claude Code sessions" />

      <div className={styles.toolbar}>
        <FilterBar projects={projects ?? []} />
        <div className={styles.toolbarRow}>
          <div className={styles.searchBox}>
            <Icon icon={Search} size="sm" tone="muted" />
            <input
              type="text"
              placeholder="Search project or branch…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={styles.searchInput}
            />
          </div>
          <label className={styles.emptyToggle}>
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
            Hide empty
          </label>
          <div className={styles.colPickerWrap}>
            <button className={styles.colPickerBtn} onClick={() => setShowColPicker((v) => !v)}>
              <Icon icon={SlidersHorizontal} size="sm" tone="muted" />
              Columns
            </button>
            {showColPicker && (
              <div className={styles.colPickerMenu}>
                {OPTIONAL.map((k) => {
                  const col = allColumns.find((c) => c.key === k)!;
                  return (
                    <label key={k} className={styles.colPickerItem}>
                      <input type="checkbox" checked={visible.has(k)} onChange={() => toggleCol(k)} />
                      {col.header as string}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <span className={styles.count}>{rows.length} session{rows.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {isLoading ? (
        <Skeleton height={400} radius="md" />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Inbox} title="No sessions" description="Adjust filters or start a Claude Code session" />
        </Card>
      ) : (
        <Card>
          <DataTable
            columns={columns}
            data={rows}
            keyFn={(s) => s.id}
            defaultSort={{ key: 'active', dir: 'desc' }}
            onRowClick={(s) => navigate(`/sessions/${s.id}`)}
            rowClassName={(s) => (s.isEmpty ? styles.rowEmpty : '')}
          />
        </Card>
      )}
    </div>
  );
}
