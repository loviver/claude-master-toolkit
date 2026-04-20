import type { GitStats } from '../../../lib/types';
import styles from './GitStatsPanel.module.css';

interface GitStatsPanelProps {
  stats: GitStats;
}

export function GitStatsPanel({ stats }: GitStatsPanelProps) {
  if (!stats.available) {
    return <p className={styles.empty}>No commits during session window</p>;
  }

  const total = stats.insertions + stats.deletions;
  const insPct = total > 0 ? (stats.insertions / total) * 100 : 0;
  const blocks = 5;
  const insBlocks = total > 0 ? Math.round((stats.insertions / total) * blocks) : 0;
  const delBlocks = blocks - insBlocks;

  return (
    <div className={styles.wrap}>
      <div className={styles.line}>
        <span className={styles.files}>
          <strong>{stats.filesChanged}</strong> {stats.filesChanged === 1 ? 'file' : 'files'} changed
        </span>
        <span className={styles.ins}>+{stats.insertions.toLocaleString()}</span>
        <span className={styles.del}>−{stats.deletions.toLocaleString()}</span>
        <span className={styles.squares} aria-hidden>
          {Array.from({ length: insBlocks }).map((_, i) => (
            <span key={`i${i}`} className={styles.sqIns} />
          ))}
          {Array.from({ length: delBlocks }).map((_, i) => (
            <span key={`d${i}`} className={styles.sqDel} />
          ))}
        </span>
      </div>
      <div className={styles.bar}>
        <div className={styles.barIns} style={{ width: `${insPct}%` }} />
      </div>
    </div>
  );
}
