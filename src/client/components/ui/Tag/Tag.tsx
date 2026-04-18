import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Tag.module.css';

type Variant = 'default' | 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'cyan';

interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  variant?: Variant;
}

export function Tag({ children, variant = 'default', className, ...props }: TagProps) {
  return (
    <span className={`${styles.tag} ${styles[variant]} ${className ?? ''}`} {...props}>
      {children}
    </span>
  );
}
