import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../Icon/Icon';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ icon, title, description, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        {icon && (
          <div className={styles.iconWrap}>
            <Icon icon={icon} size="lg" tone="claude" />
          </div>
        )}
        <div>
          <h1 className={styles.title}>{title}</h1>
          {description && <p className={styles.description}>{description}</p>}
        </div>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
