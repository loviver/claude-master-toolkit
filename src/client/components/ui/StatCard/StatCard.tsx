import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Icon } from '../Icon/Icon';
import styles from './StatCard.module.css';

type Accent = 'claude' | 'blue' | 'orange' | 'green' | 'purple' | 'cyan' | 'red' | 'amber';
type Trend = 'up' | 'down' | 'neutral';

interface StatCardProps {
  label: string;
  value: ReactNode;
  accent?: Accent;
  trend?: Trend;
  hint?: ReactNode;
}

const TREND_ICON = { up: TrendingUp, down: TrendingDown, neutral: Minus } as const;

export function StatCard({ label, value, accent = 'blue', trend, hint }: StatCardProps) {
  return (
    <div className={`${styles.card} ${styles[accent]}`}>
      <span className={styles.label}>{label}</span>
      <div className={styles.valueRow}>
        <span className={`${styles.value} ${styles[`tone-${accent}`]}`}>{value}</span>
        {trend && (
          <span className={`${styles.trend} ${styles[`trend-${trend}`]}`}>
            <Icon icon={TREND_ICON[trend]} size="xs" />
          </span>
        )}
      </div>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
