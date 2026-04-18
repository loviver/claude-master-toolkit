import type { HTMLAttributes, ReactNode } from 'react';
import styles from './FormGroup.module.css';

interface FormGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function FormGroup({ children, className, ...props }: FormGroupProps) {
  return (
    <div className={`${styles.group} ${className ?? ''}`} {...props}>
      {children}
    </div>
  );
}
