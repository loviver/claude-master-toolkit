import { GitBranch } from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { usePhaseBreakdown, useProjects } from '../../hooks/queries/useStats';
import { useFilters } from '../../lib/filters';
import {
  PageHeader, FilterBar, Card, CardHeader, CardTitle, CardContent, Badge, phaseBadgeVariant,
  Progress, EmptyState, Skeleton, Stack,
} from '../../components/ui';
import { PHASE_COLOR } from '../../lib/model-colors';
import { formatTokens, formatPercent } from '../../lib/format';
import { chartTooltipStyle } from '../../components/charts/chartTheme';
import type { Phase } from '../../lib/types';
import styles from './Phases.module.css';

const ACCENTS: Record<string, 'cyan' | 'blue' | 'green' | 'purple'> = {
  exploration: 'cyan',
  implementation: 'blue',
  testing: 'green',
  unknown: 'purple',
};

export function Phases() {
  const { filters } = useFilters();
  const { data: projects } = useProjects(filters);
  const { data: phases, isLoading } = usePhaseBreakdown(filters);

  return (
    <div className={styles.page}>
      <PageHeader icon={GitBranch} title="Phase Breakdown" description="How turns distribute across exploration, implementation and testing" />
      <FilterBar projects={projects ?? []} />

      {isLoading ? (
        <Skeleton height={400} radius="md" />
      ) : !phases || Object.keys(phases).length === 0 ? (
        <Card>
          <EmptyState icon={GitBranch} title="No phase data yet" description="Sync sessions to see phase distribution" />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>Distribution</CardTitle></CardHeader>
            <CardContent>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={Object.entries(phases).map(([name, s]) => ({ name, value: s.turns, pct: s.pct }))}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      stroke="var(--bg-surface)"
                      label={({ name, pct }) => `${name} · ${formatPercent(pct)}`}
                    >
                      {Object.keys(phases).map((p) => (
                        <Cell key={p} fill={PHASE_COLOR[p as Phase] ?? PHASE_COLOR.unknown} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={chartTooltipStyle} formatter={(value: number) => `${value} turns`} />
                    <Legend wrapperStyle={{ fontSize: 'var(--text-xs)', paddingTop: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <Stack gap={4}>
                {Object.entries(phases).map(([phase, stats]) => (
                  <div key={phase} className={styles.row}>
                    <Badge variant={phaseBadgeVariant(phase as Phase)}>{phase}</Badge>
                    <div className={styles.progress}>
                      <Progress
                        value={stats.pct}
                        label={`${stats.turns} turns · ${formatTokens(stats.tokens)}`}
                        accent={ACCENTS[phase] ?? 'purple'}
                      />
                    </div>
                  </div>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
