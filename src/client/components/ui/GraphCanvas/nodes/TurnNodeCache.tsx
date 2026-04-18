import styles from '../GraphCanvas.module.css';

interface Props {
  pct: number;
}

export function TurnNodeCache({ pct }: Props) {
  const safe = Math.max(0, Math.min(100, pct));
  return (
    <div className={styles.cacheRow} title={`Cache hit ratio: ${safe}%`}>
      <div className={styles.cacheBar}>
        <div className={styles.cacheFill} style={{ width: `${safe}%` }} />
      </div>
      <span className={styles.cacheLabel}>{safe}%</span>
    </div>
  );
}
