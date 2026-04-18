import {
  LayoutDashboard, DollarSign, Hash, Zap, Gauge, Wrench, Cpu, TrendingUp, Activity,
} from 'lucide-react';
import { useDashboard, useProjects } from '../../hooks/queries/useStats';
import { useFilters } from '../../lib/filters';
import {
  PageHeader, FilterBar, MetricTile, Grid, Card, CardHeader, CardTitle, CardContent,
  Badge, modelKeyBadgeVariant, phaseBadgeVariant, EmptyState, SkeletonGrid, Stack, Icon,
} from '../../components/ui';
import { TokenTimelineChart } from '../../components/charts';
import { formatCost, formatTokens, formatPercent } from '../../lib/format';
import styles from './Overview.module.css';

export function Overview() {
  const { filters } = useFilters();
  const { data, isLoading } = useDashboard(filters);
  const { data: projects } = useProjects(filters);

  const pageHeader = (
    <PageHeader
      icon={LayoutDashboard}
      title="Overview"
      description="Session analytics, cost and efficiency at a glance"
    />
  );

  if (isLoading || !data) {
    return (
      <div>
        {pageHeader}
        <FilterBar projects={projects ?? []} />
        <SkeletonGrid count={6} height={96} />
      </div>
    );
  }

  const { current, timeline, models, phases, tools, efficiency } = data;
  const topPhase = Object.entries(phases).sort((a, b) => b[1].pct - a[1].pct)[0];
  const topTools = Object.entries(tools.frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  return (
    <div className={styles.page}>
      {pageHeader}
      <FilterBar projects={projects ?? []} />

      <Grid cols={3} minItemWidth={220} className={styles.metrics}>
        <MetricTile
          icon={Activity}
          tone="claude"
          label="Total Sessions"
          value={current.totalSessions}
          hint={`${current.activeProjects} active projects`}
        />
        <MetricTile
          icon={DollarSign}
          tone="amber"
          label="Total Cost"
          value={formatCost(current.totalCostUsd, 2)}
          hint={`${formatCost(current.avgCostPerSession)} avg/session`}
        />
        <MetricTile
          icon={Hash}
          tone="blue"
          label="Total Turns"
          value={current.totalTurns.toLocaleString()}
        />
        <MetricTile
          icon={Gauge}
          tone={efficiency.score >= 70 ? 'green' : efficiency.score >= 40 ? 'amber' : 'red'}
          label="Efficiency"
          value={`${efficiency.score}/100`}
          hint={`cache ${formatPercent(efficiency.breakdown.cacheHitRatio)}`}
        />
        <MetricTile
          icon={TrendingUp}
          tone="cyan"
          label="Top Phase"
          value={topPhase ? topPhase[0] : '—'}
          hint={topPhase ? `${formatPercent(topPhase[1].pct)} of turns` : undefined}
        />
        <MetricTile
          icon={Zap}
          tone="purple"
          label="Latest Session"
          value={current.latestSession ? <Badge variant={modelKeyBadgeVariant(current.latestSession.primaryModelKey)}>{current.latestSession.primaryModelKey}</Badge> : '—'}
          hint={current.latestSession ? `${current.latestSession.turnCount} turns · ${formatCost(current.latestSession.costUsd)}` : undefined}
        />
      </Grid>

      <Card className={styles.chartCard}>
        <CardHeader>
          <CardTitle>Token Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <EmptyState icon={Activity} title="No activity yet" description="Start a Claude Code session to see usage" />
          ) : (
            <TokenTimelineChart data={timeline} />
          )}
        </CardContent>
      </Card>

      <Grid cols={2} minItemWidth={360} className={styles.split}>
        <Card>
          <CardHeader>
            <CardTitle>Top Models</CardTitle>
            <Icon icon={Cpu} size="sm" tone="muted" />
          </CardHeader>
          <CardContent>
            {models.length === 0 ? (
              <EmptyState icon={Cpu} title="No model usage" />
            ) : (
              <Stack gap={2}>
                {models.slice(0, 5).map((m) => (
                  <div key={m.model} className={styles.row}>
                    <div className={styles.rowLeft}>
                      <Badge variant={modelKeyBadgeVariant(m.modelKey)}>{m.modelKey}</Badge>
                      <span className={styles.rowSub}>{m.turns} turns · {m.sessionCount} sessions</span>
                    </div>
                    <div className={styles.rowRight}>
                      <span className={styles.rowValue}>{formatPercent(m.percentage)}</span>
                      <span className={styles.rowSub}>{formatCost(m.costUsd)}</span>
                    </div>
                  </div>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Tools</CardTitle>
            <Icon icon={Wrench} size="sm" tone="muted" />
          </CardHeader>
          <CardContent>
            {topTools.length === 0 ? (
              <EmptyState icon={Wrench} title="No tool usage" />
            ) : (
              <Stack gap={2}>
                {topTools.map(([tool, count]) => (
                  <div key={tool} className={styles.row}>
                    <span className={styles.tool}>{tool}</span>
                    <span className={styles.rowValue}>{count}</span>
                  </div>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Grid>

      <Card className={styles.phaseCard}>
        <CardHeader>
          <CardTitle>Phase Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={styles.phaseRow}>
            {Object.entries(phases).map(([phase, stats]) => (
              <div key={phase} className={styles.phaseCell}>
                <Badge variant={phaseBadgeVariant(phase as never)}>{phase}</Badge>
                <span className={styles.phaseValue}>{formatPercent(stats.pct)}</span>
                <span className={styles.phaseSub}>{stats.turns} turns · {formatTokens(stats.tokens)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
