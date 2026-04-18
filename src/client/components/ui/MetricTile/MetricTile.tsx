import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Icon } from '../Icon/Icon';
import styles from './MetricTile.module.css';

type Tone = 'claude' | 'blue' | 'green' | 'red' | 'amber' | 'cyan' | 'purple';

interface MetricTileProps {
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  trend?: { value: string; direction: 'up' | 'down' | 'neutral' };
}

export function MetricTile({ icon, label, value, hint, tone = 'blue', trend }: MetricTileProps) {
  const TrendIcon = trend?.direction === 'up'
    ? TrendingUp
    : trend?.direction === 'down'
      ? TrendingDown
      : Minus;

  return (
    <div className={`${styles.tile} ${styles[tone]}`}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        {icon && <Icon icon={icon} size="sm" tone={tone} />}
      </div>
      <div className={styles.value}>{value}</div>
      <div className={styles.foot}>
        {hint && <span className={styles.hint}>{hint}</span>}
        {trend && (
          <span className={`${styles.trend} ${styles[`trend-${trend.direction}`]}`}>
            <Icon icon={TrendIcon} size="xs" />
            {trend.value}
          </span>
        )}
      </div>
    </div>
  );
}
