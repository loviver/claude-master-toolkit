import { DollarSign, Hash, Database, Clock, Zap, GitCommit } from 'lucide-react';
import type { SessionDetail } from '../../lib/types';
import { Grid, MetricTile } from '../../components/ui';
import { formatCost, formatDuration, formatPercent, formatTokens } from '../../lib/format';

interface Props {
  session: SessionDetail;
}

export function SessionStats({ session }: Props) {
  const duration = session.lastActiveAt - session.startedAt;
  const minutes = duration / 60_000;
  const turnsPerHour = minutes > 0 ? Math.round((session.turnCount / minutes) * 60 * 10) / 10 : 0;
  const cacheInput = session.tokens.cacheReadTokens + session.tokens.inputTokens;
  const cacheHit = cacheInput > 0 ? (session.tokens.cacheReadTokens / cacheInput) * 100 : 0;

  return (
    <Grid cols={3} minItemWidth={200}>
      <MetricTile icon={DollarSign} tone="amber" label="Total Cost" value={formatCost(session.costUsd)} hint={`${formatCost(session.costUsd / Math.max(session.turnCount, 1))} per turn`} />
      <MetricTile icon={Hash} tone="claude" label="Turns" value={session.turnCount} hint={session.sidechainTurns ? `${session.sidechainTurns} sidechain` : undefined} />
      <MetricTile icon={Database} tone="blue" label="Input" value={formatTokens(session.tokens.inputTokens)} hint={`${formatTokens(session.tokens.cacheReadTokens)} cache read`} />
      <MetricTile icon={GitCommit} tone="green" label="Output" value={formatTokens(session.tokens.outputTokens)} />
      <MetricTile icon={Clock} tone="cyan" label="Duration" value={formatDuration(duration)} hint={`${turnsPerHour} turns/h`} />
      <MetricTile icon={Zap} tone="purple" label="Cache Hit" value={formatPercent(cacheHit)} />
    </Grid>
  );
}
