import { Zap, Database, Activity, Gauge, Target } from 'lucide-react';
import { useEfficiencyScore } from '../../hooks/queries/useStats';
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Progress, EmptyState, Skeleton,
  MetricTile, Grid, Stack,
} from '../../components/ui';
import { formatPercent } from '../../lib/format';
import styles from './Efficiency.module.css';

const BREAKDOWN: Record<string, { label: string; accent: 'cyan' | 'blue' | 'green' | 'orange'; description: string }> = {
  tokensPerTurn: { label: 'Tokens per Turn',    accent: 'cyan',   description: 'Lower is more efficient per turn' },
  cacheHitRatio: { label: 'Cache Hit Ratio',    accent: 'blue',   description: 'Higher reuse lowers cost' },
  errorRecovery: { label: 'Error Recovery',     accent: 'orange', description: 'Recovery from max_tokens truncation' },
  phaseBalance:  { label: 'Phase Balance',      accent: 'green',  description: 'Even spread across phase types' },
};

function scoreTone(score: number): 'green' | 'amber' | 'red' {
  if (score >= 70) return 'green';
  if (score >= 40) return 'amber';
  return 'red';
}

export function Efficiency() {
  const { data: score, isLoading } = useEfficiencyScore();

  return (
    <div className={styles.page}>
      <PageHeader icon={Zap} title="Session Efficiency" description="How well your sessions use tokens, cache and turns" />

      {isLoading ? (
        <Skeleton height={400} radius="md" />
      ) : !score ? (
        <Card>
          <EmptyState icon={Zap} title="No efficiency data yet" />
        </Card>
      ) : (
        <>
          <Grid cols={4} minItemWidth={180}>
            <MetricTile icon={Target}   tone={scoreTone(score.score)} label="Overall Score" value={`${score.score}/100`} />
            <MetricTile icon={Database} tone="blue"   label="Cache Hit"      value={formatPercent(score.breakdown.cacheHitRatio)} />
            <MetricTile icon={Activity} tone="cyan"   label="Tokens/Turn"    value={formatPercent(score.breakdown.tokensPerTurn)} />
            <MetricTile icon={Gauge}    tone="green"  label="Phase Balance"  value={formatPercent(score.breakdown.phaseBalance)} />
          </Grid>

          <Card>
            <CardHeader><CardTitle>Score Breakdown</CardTitle></CardHeader>
            <CardContent>
              <Stack gap={5}>
                {Object.entries(score.breakdown).map(([key, value]) => {
                  const config = BREAKDOWN[key];
                  if (!config) return null;
                  return (
                    <div key={key}>
                      <Progress value={value} label={config.label} accent={config.accent} />
                      <p className={styles.hint}>{config.description}</p>
                    </div>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
