import { Cpu } from 'lucide-react';
import { useModelStats } from '../../hooks/queries/useStats';
import { useProjects } from '../../hooks/queries/useStats';
import { useFilters } from '../../lib/filters';
import {
  PageHeader, FilterBar, Card, CardHeader, CardTitle, CardContent, DataTable, Badge,
  modelKeyBadgeVariant, EmptyState, Skeleton,
} from '../../components/ui';
import { ModelPieChart } from '../../components/charts';
import { formatCost, formatPercent, formatTokens, shortModel } from '../../lib/format';
import type { ModelStats } from '../../lib/types';
import styles from './Models.module.css';

const columns = [
  {
    key: 'model',
    header: 'Model',
    render: (m: ModelStats) => (
      <div className={styles.modelCell}>
        <Badge variant={modelKeyBadgeVariant(m.modelKey)}>{m.modelKey}</Badge>
        <span className={styles.full}>{shortModel(m.model)}</span>
      </div>
    ),
  },
  { key: 'sessions', header: 'Sessions',  align: 'right' as const, render: (m: ModelStats) => m.sessionCount },
  { key: 'turns',    header: 'Turns',     align: 'right' as const, render: (m: ModelStats) => m.turns.toLocaleString() },
  { key: 'input',    header: 'Input',     align: 'right' as const, render: (m: ModelStats) => formatTokens(m.tokens.input) },
  { key: 'output',   header: 'Output',    align: 'right' as const, render: (m: ModelStats) => formatTokens(m.tokens.output) },
  { key: 'cacheR',   header: 'Cache R',   align: 'right' as const, render: (m: ModelStats) => formatTokens(m.tokens.cacheRead) },
  { key: 'cacheW',   header: 'Cache W',   align: 'right' as const, render: (m: ModelStats) => formatTokens(m.tokens.cacheCreation) },
  { key: 'cost',     header: 'Cost',      align: 'right' as const, render: (m: ModelStats) => <span className={styles.cost}>{formatCost(m.costUsd)}</span> },
  { key: 'pct',      header: 'Share',     align: 'right' as const, render: (m: ModelStats) => formatPercent(m.percentage) },
];

export function Models() {
  const { filters } = useFilters();
  const { data: projects } = useProjects(filters);
  const { data, isLoading } = useModelStats(filters);

  return (
    <div className={styles.page}>
      <PageHeader icon={Cpu} title="Model Usage" description="Per-model cost, tokens and turn share" />
      <FilterBar projects={projects ?? []} />

      {isLoading ? (
        <Skeleton height={400} radius="md" />
      ) : !data || data.length === 0 ? (
        <Card>
          <EmptyState icon={Cpu} title="No model usage yet" />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>Cost Distribution</CardTitle></CardHeader>
            <CardContent>
              <ModelPieChart data={data} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Detailed Breakdown</CardTitle></CardHeader>
            <CardContent>
              <DataTable columns={columns} data={data} keyFn={(m) => m.model} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
