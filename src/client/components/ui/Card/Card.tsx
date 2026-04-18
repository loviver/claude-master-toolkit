import type { ReactNode, HTMLAttributes } from 'react';
import styles from './Card.module.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: 'default' | 'ghost' | 'elevated';
}

export function Card({ children, variant = 'default', className, ...props }: CardProps) {
  return (
    <div className={`${styles.card} ${styles[variant]} ${className ?? ''}`} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`${styles.header} ${className ?? ''}`} {...props}>{children}</div>;
}

export function CardTitle({ children, className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={`${styles.title} ${className ?? ''}`} {...props}>{children}</h3>;
}

export function CardContent({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`${styles.content} ${className ?? ''}`} {...props}>{children}</div>;
}
