import { DollarSign, Hash, Database, Clock, Zap, GitCommit } from 'lucide-react';
import type { SessionDetail } from '../../../lib/types';
import { MetricTile } from '../../../components/ui';
import { formatCost, formatDuration, formatPercent, formatTokens } from '../../../lib/format';
import { useSessionStats } from '../../../hooks/useSessionStats';
import styles from './StatsBand.module.css';

interface StatsBandProps {
  session: SessionDetail;
}

export function StatsBand({ session }: StatsBandProps) {
  const { durationMs, turnsPerHour, cacheHitPct, costPerTurn } = useSessionStats(session);

  return (
    <div className={styles.band}>
      <div className={styles.hero}>
        <MetricTile
          icon={DollarSign}
          tone="amber"
          label="Total Cost"
          value={formatCost(session.costUsd)}
          hint={`${formatCost(costPerTurn)} per turn`}
        />
      </div>
      <div className={styles.grid}>
        <MetricTile icon={Hash} tone="claude" label="Turns" value={session.turnCount} hint={session.sidechainTurns ? `${session.sidechainTurns} sidechain` : undefined} />
        <MetricTile icon={Database} tone="blue" label="Input" value={formatTokens(session.tokens.inputTokens)} hint={`${formatTokens(session.tokens.cacheReadTokens)} cache read`} />
        <MetricTile icon={GitCommit} tone="green" label="Output" value={formatTokens(session.tokens.outputTokens)} />
        <MetricTile icon={Clock} tone="cyan" label="Duration" value={formatDuration(durationMs)} hint={`${turnsPerHour} turns/h`} />
        <MetricTile icon={Zap} tone="purple" label="Cache Hit" value={formatPercent(cacheHitPct)} />
      </div>
    </div>
  );
}
