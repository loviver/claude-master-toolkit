import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../Icon/Icon';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.wrapper}>
      {icon && (
        <div className={styles.iconWrap}>
          <Icon icon={icon} size="xl" tone="muted" />
        </div>
      )}
      <h3 className={styles.title}>{title}</h3>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
