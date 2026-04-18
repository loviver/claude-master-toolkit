import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListOrdered, Search, Inbox } from 'lucide-react';
import { useSessions } from '../../hooks/queries/useSessions';
import { useProjects } from '../../hooks/queries/useStats';
import { useFilters } from '../../lib/filters';
import {
  PageHeader, FilterBar, Card, DataTable, Badge, modelKeyBadgeVariant, phaseBadgeVariant,
  EmptyState, Skeleton, Input, Icon,
} from '../../components/ui';
import { formatTokens, formatCost, formatRelativeTime, formatProjectName, shortModel } from '../../lib/format';
import type { SessionSummary } from '../../lib/types';
import styles from './SessionList.module.css';

const columns = [
  {
    key: 'project',
    header: 'Project',
    render: (s: SessionSummary) => (
      <span className={styles.project}>{formatProjectName(s.projectPath)}</span>
    ),
  },
  {
    key: 'branch',
    header: 'Branch',
    render: (s: SessionSummary) => (
      <span className={styles.branch}>{s.gitBranch ?? '—'}</span>
    ),
  },
  {
    key: 'model',
    header: 'Model',
    render: (s: SessionSummary) => (
      <div className={styles.modelCell}>
        <Badge variant={modelKeyBadgeVariant(s.primaryModelKey)}>{shortModel(s.primaryModel)}</Badge>
        {s.models.length > 1 && <span className={styles.mix}>+{s.models.length - 1}</span>}
      </div>
    ),
  },
  {
    key: 'phase',
    header: 'Phase',
    render: (s: SessionSummary) => <Badge variant={phaseBadgeVariant(s.dominantPhase)}>{s.dominantPhase}</Badge>,
  },
  { key: 'turns',  header: 'Turns',  align: 'right' as const, render: (s: SessionSummary) => s.turnCount },
  {
    key: 'side',
    header: 'Sidechain',
    align: 'right' as const,
    render: (s: SessionSummary) => s.sidechainTurns || '—',
  },
  { key: 'tools',  header: 'Tools',  align: 'right' as const, render: (s: SessionSummary) => s.toolCount || '—' },
  { key: 'input',  header: 'Input',  align: 'right' as const, render: (s: SessionSummary) => formatTokens(s.tokens.inputTokens) },
  { key: 'output', header: 'Output', align: 'right' as const, render: (s: SessionSummary) => formatTokens(s.tokens.outputTokens) },
  {
    key: 'cost',
    header: 'Cost',
    align: 'right' as const,
    render: (s: SessionSummary) => <span className={styles.cost}>{formatCost(s.costUsd)}</span>,
  },
  {
    key: 'active',
    header: 'Active',
    render: (s: SessionSummary) => <span className={styles.time}>{formatRelativeTime(s.lastActiveAt)}</span>,
  },
];

export function SessionList() {
  const { filters } = useFilters();
  const { data: projects } = useProjects(filters);
  const [q, setQ] = useState('');
  const { data, isLoading } = useSessions({ ...filters, q: q || undefined, limit: 200 });
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <PageHeader icon={ListOrdered} title="Sessions" description="Browse and drill into recorded Claude Code sessions" />
      <FilterBar projects={projects ?? []} />

      <div className={styles.searchRow}>
        <Icon icon={Search} size="sm" tone="muted" />
        <Input
          type="text"
          placeholder="Search project or branch…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={styles.searchInput}
        />
      </div>

      {isLoading ? (
        <Skeleton height={400} radius="md" />
      ) : !data || data.length === 0 ? (
        <Card>
          <EmptyState icon={Inbox} title="No sessions yet" description="Start a Claude Code session to populate the dashboard" />
        </Card>
      ) : (
        <Card>
          <DataTable
            columns={columns}
            data={data}
            keyFn={(s) => s.id}
            onRowClick={(s) => navigate(`/sessions/${s.id}`)}
          />
        </Card>
      )}
    </div>
  );
}
