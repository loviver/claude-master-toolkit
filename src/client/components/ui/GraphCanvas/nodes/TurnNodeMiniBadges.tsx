import {
  AlertTriangle,
  Brain,
  FileEdit,
  Globe,
  Info,
  Package,
  RefreshCw,
  Webhook,
  XOctagon,
} from 'lucide-react';
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
  toolsErrorCount?: number;
  isMeta?: boolean;
  isCompactSummary?: boolean;
}

type BadgeDef = {
  key: string;
  Icon: React.ComponentType<{ size?: number }>;
  label: string;
  title: string;
  tone?: 'error' | 'warn' | 'info';
};

export function TurnNodeMiniBadges(p: Props) {
  const badges: BadgeDef[] = [];

  if ((p.toolsErrorCount ?? 0) > 0) {
    badges.push({
      key: 'toolerr',
      Icon: XOctagon,
      label: `${p.toolsErrorCount} err`,
      title: `${p.toolsErrorCount} tool call(s) errored`,
      tone: 'error',
    });
  }
  if (p.isApiError) {
    badges.push({
      key: 'apierr',
      Icon: AlertTriangle,
      label: p.apiErrorStatus ? String(p.apiErrorStatus) : 'api',
      title: `API error${p.apiErrorStatus ? `: ${p.apiErrorStatus}` : ''}`,
      tone: 'error',
    });
  }
  if (p.isMeta) {
    badges.push({ key: 'meta', Icon: Info, label: 'meta', title: 'Meta turn', tone: 'info' });
  }
  if (p.isCompactSummary) {
    badges.push({ key: 'compact', Icon: Package, label: 'compact', title: 'Compact summary turn' });
  }
  if (p.hasThinking) {
    badges.push({ key: 'think', Icon: Brain, label: 'thinking', title: 'Thinking block present' });
  }
  if ((p.iterationsCount ?? 0) > 1) {
    badges.push({
      key: 'iter',
      Icon: RefreshCw,
      label: `×${p.iterationsCount}`,
      title: `${p.iterationsCount} internal iterations`,
    });
  }
  const web = (p.webSearchCount ?? 0) + (p.webFetchCount ?? 0);
  if (web > 0) {
    badges.push({
      key: 'web',
      Icon: Globe,
      label: String(web),
      title: `web_search=${p.webSearchCount ?? 0}, web_fetch=${p.webFetchCount ?? 0}`,
    });
  }
  if ((p.hooksCount ?? 0) > 0) {
    badges.push({
      key: 'hook',
      Icon: Webhook,
      label: String(p.hooksCount),
      title: `${p.hooksCount} hook(s) fired`,
    });
  }
  if ((p.filesChangedCount ?? 0) > 0) {
    badges.push({
      key: 'files',
      Icon: FileEdit,
      label: String(p.filesChangedCount),
      title: `${p.filesChangedCount} file(s) changed`,
    });
  }

  if (badges.length === 0) return null;
  return (
    <div className={styles.row}>
      {badges.map((b) => (
        <span
          key={b.key}
          className={`${styles.badge} ${b.tone === 'error' ? styles.error : ''} ${b.tone === 'info' ? styles.info : ''}`}
          title={b.title}
        >
          <b.Icon size={10} />
          <span className={styles.label}>{b.label}</span>
        </span>
      ))}
    </div>
  );
}
