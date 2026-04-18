import { useNavigate } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { useProjects, useActivity } from '../../hooks/queries/useStats';
import { useFilters } from '../../lib/filters';
import {
  PageHeader, FilterBar, Card, CardHeader, CardTitle, CardContent, DataTable, Badge,
  modelKeyBadgeVariant, EmptyState, Skeleton, Heatmap,
} from '../../components/ui';
import { formatCost, formatRelativeTime, formatProjectName } from '../../lib/format';
import type { ProjectStats } from '../../lib/types';
import styles from './Projects.module.css';

const columns = [
  {
    key: 'project',
    header: 'Project',
    render: (p: ProjectStats) => (
      <div>
        <div className={styles.name}>{p.projectName || formatProjectName(p.projectPath)}</div>
        <div className={styles.path}>{p.projectPath}</div>
      </div>
    ),
  },
  { key: 'sessions', header: 'Sessions', align: 'right' as const, render: (p: ProjectStats) => p.sessionCount },
  { key: 'turns',    header: 'Turns',    align: 'right' as const, render: (p: ProjectStats) => p.turnCount.toLocaleString() },
  {
    key: 'model',
    header: 'Dominant Model',
    render: (p: ProjectStats) => <Badge variant={modelKeyBadgeVariant(p.dominantModel)}>{p.dominantModel}</Badge>,
  },
  {
    key: 'cost',
    header: 'Cost',
    align: 'right' as const,
    render: (p: ProjectStats) => <span className={styles.cost}>{formatCost(p.costUsd, 2)}</span>,
  },
  {
    key: 'active',
    header: 'Last Active',
    render: (p: ProjectStats) => <span className={styles.time}>{formatRelativeTime(p.lastActiveAt)}</span>,
  },
];

export function Projects() {
  const { filters } = useFilters();
  const { data: projects, isLoading } = useProjects(filters);
  const { data: activity } = useActivity(filters);
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <PageHeader icon={FolderKanban} title="Projects" description="Rollup of session activity per project" />
      <FilterBar projects={projects ?? []} showProject={false} />

      {isLoading ? (
        <Skeleton height={400} radius="md" />
      ) : !projects || projects.length === 0 ? (
        <Card>
          <EmptyState icon={FolderKanban} title="No project data yet" />
        </Card>
      ) : (
        <>
          {activity && activity.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Activity Heatmap</CardTitle></CardHeader>
              <CardContent>
                <Heatmap data={activity.map((a) => ({ dow: a.dow, hour: a.hour, value: a.turns }))} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Per-Project Rollup</CardTitle></CardHeader>
            <CardContent>
              <DataTable
                columns={columns}
                data={projects}
                keyFn={(p) => p.projectPath}
                onRowClick={(p) => navigate(`/sessions?project=${encodeURIComponent(p.projectPath)}`)}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
