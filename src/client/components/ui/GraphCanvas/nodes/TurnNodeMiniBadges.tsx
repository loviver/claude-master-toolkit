import styles from './TurnNodeMiniBadges.module.css';

interface Props {
  hasThinking?: boolean;
  iterationsCount?: number;
  webSearchCount?: number;
  webFetchCount?: number;
  hooksCount?: number;
  filesChangedCount?: number;
  isApiError?: boolean;
  apiErrorStatus?: string | null;
}

export function TurnNodeMiniBadges(p: Props) {
  const badges: Array<{ key: string; icon: string; label: string; title: string; cls?: string }> = [];

  if (p.isApiError) {
    badges.push({
      key: 'err',
      icon: '⚠',
      label: p.apiErrorStatus ? String(p.apiErrorStatus) : 'err',
      title: `API error${p.apiErrorStatus ? `: ${p.apiErrorStatus}` : ''}`,
      cls: styles.error,
    });
  }
  if (p.hasThinking) {
    badges.push({ key: 'think', icon: '🧠', label: 'think', title: 'Thinking block present' });
  }
  if ((p.iterationsCount ?? 0) > 1) {
    badges.push({
      key: 'iter',
      icon: '🔁',
      label: `×${p.iterationsCount}`,
      title: `${p.iterationsCount} internal iterations`,
    });
  }
  const web = (p.webSearchCount ?? 0) + (p.webFetchCount ?? 0);
  if (web > 0) {
    badges.push({
      key: 'web',
      icon: '🌐',
      label: String(web),
      title: `web_search=${p.webSearchCount ?? 0}, web_fetch=${p.webFetchCount ?? 0}`,
    });
  }
  if ((p.hooksCount ?? 0) > 0) {
    badges.push({
      key: 'hook',
      icon: '🪝',
      label: String(p.hooksCount),
      title: `${p.hooksCount} hook(s) fired`,
    });
  }
  if ((p.filesChangedCount ?? 0) > 0) {
    badges.push({
      key: 'files',
      icon: '📝',
      label: String(p.filesChangedCount),
      title: `${p.filesChangedCount} file(s) changed`,
    });
  }

  if (badges.length === 0) return null;
  return (
    <div className={styles.row}>
      {badges.map((b) => (
        <span key={b.key} className={`${styles.badge} ${b.cls ?? ''}`} title={b.title}>
          <span className={styles.icon}>{b.icon}</span>
          <span className={styles.label}>{b.label}</span>
        </span>
      ))}
    </div>
  );
}
