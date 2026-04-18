import type { ReactNode } from 'react';
import styles from './Badge.module.css';
import type { ModelKey, Phase } from '../../../lib/types';

export type BadgeVariant =
  | 'default'
  | 'opus' | 'sonnet' | 'haiku' | 'unknown'
  | 'exploration' | 'implementation' | 'testing'
  | 'success' | 'warning' | 'error' | 'info'
  | 'sidechain';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

export function Badge({ children, variant = 'default', size = 'sm' }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[variant]} ${styles[size]}`}>{children}</span>;
}

export function modelBadgeVariant(model: string): BadgeVariant {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'unknown';
}

export function phaseBadgeVariant(phase: Phase | string): BadgeVariant {
  switch (phase) {
    case 'exploration':    return 'exploration';
    case 'implementation': return 'implementation';
    case 'testing':        return 'testing';
    default:               return 'unknown';
  }
}

export function modelKeyBadgeVariant(key: ModelKey): BadgeVariant {
  return key;
}
