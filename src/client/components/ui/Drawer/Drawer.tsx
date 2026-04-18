import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Icon } from '../Icon/Icon';
import styles from './Drawer.module.css';

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  side?: 'right' | 'left';
  width?: number;
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  headerActions,
  side = 'right',
  width = 480,
}: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={`${styles.content} ${styles[side]}`}
          style={{ width }}
        >
          <div className={styles.header}>
            <div className={styles.titleRow}>
              <Dialog.Title className={styles.title}>{title}</Dialog.Title>
              {description && (
                <Dialog.Description className={styles.description}>{description}</Dialog.Description>
              )}
            </div>
            {headerActions}
            <Dialog.Close asChild>
              <button className={styles.close} aria-label="Close">
                <Icon icon={X} size="md" tone="muted" />
              </button>
            </Dialog.Close>
          </div>
          <div className={styles.body}>{children}</div>
          {footer && <div className={styles.footer}>{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
