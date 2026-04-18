import * as RadixProgress from '@radix-ui/react-progress';
import styles from './Progress.module.css';

interface ProgressProps {
  value: number;
  max?: number;
  label?: string;
  accent?: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'cyan';
}

export function Progress({ value, max = 100, label, accent = 'blue' }: ProgressProps) {
  const pct = Math.round((value / max) * 100);

  return (
    <div className={styles.wrapper}>
      {label && (
        <div className={styles.header}>
          <span className={styles.label}>{label}</span>
          <span className={styles.value}>{pct}%</span>
        </div>
      )}
      <RadixProgress.Root className={styles.root} value={value} max={max}>
        <RadixProgress.Indicator
          className={`${styles.indicator} ${styles[accent]}`}
          style={{ width: `${pct}%` }}
        />
      </RadixProgress.Root>
    </div>
  );
}
