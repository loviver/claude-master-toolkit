import type { ReactNode, HTMLAttributes } from 'react';
import styles from './Section.module.css';

interface SectionProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  title?: string;
  description?: string;
}

export function Section({ children, title, description, className, ...props }: SectionProps) {
  return (
    <section className={`${styles.section} ${className ?? ''}`} {...props}>
      {(title || description) && (
        <div className={styles.header}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {description && <p className={styles.description}>{description}</p>}
        </div>
      )}
      <div className={styles.content}>{children}</div>
    </section>
  );
}
