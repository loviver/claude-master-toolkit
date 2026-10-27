import { DollarSign, Hash, Database, Clock, Zap, PenLine } from 'lucide-react';
import type { SessionDetail } from '../../../lib/types';
import { MetricTile } from '../../../components/ui';
import { formatCost, formatDuration, formatPercent, formatTokens } from '../../../lib/format';
import { useSessionStats } from '../../../hooks/useSessionStats';
import styles from './StatsBand.module.css';

interface StatsBandProps {
  session: SessionDetail;
}

export function StatsBand({ session }: StatsBandProps) {
  const { durationMs, turnsPerHour, cacheHitPct, costPerTurn, contextTokens } = useSessionStats(session);
  const { inputTokens, cacheReadTokens, cacheCreationTokens } = session.tokens;

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
        <MetricTile
          icon={Database}
          tone="blue"
          label="Context read"
          value={formatTokens(contextTokens)}
          hint={`${formatTokens(inputTokens)} uncached · ${formatTokens(cacheCreationTokens)} written`}
        />
        <MetricTile icon={PenLine} tone="green" label="Output" value={formatTokens(session.tokens.outputTokens)} />
        <MetricTile icon={Clock} tone="cyan" label="Duration" value={formatDuration(durationMs)} hint={`${turnsPerHour} turns/h`} />
        <MetricTile
          icon={Zap}
          tone="purple"
          label="Cache Hit"
          value={formatPercent(cacheHitPct, 1)}
          hint={`${formatTokens(cacheReadTokens)} read from cache`}
        />
      </div>
    </div>
  );
}
