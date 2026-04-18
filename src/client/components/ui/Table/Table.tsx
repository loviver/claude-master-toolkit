import type { ReactNode, TableHTMLAttributes, THeadHTMLAttributes, TBodyHTMLAttributes, TrHTMLAttributes } from 'react';
import styles from './Table.module.css';

interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

export function Table({ children, className, ...props }: TableProps) {
  return (
    <div className={styles.wrapper}>
      <table className={`${styles.table} ${className ?? ''}`} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children, className, ...props }: THeadHTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`${styles.head} ${className ?? ''}`} {...props}>{children}</thead>;
}

export function TableBody({ children, className, ...props }: TBodyHTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={`${styles.body} ${className ?? ''}`} {...props}>{children}</tbody>;
}

export function TableRow({ children, className, ...props }: TrHTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`${styles.row} ${className ?? ''}`} {...props}>{children}</tr>;
}

interface TableCellProps extends TrHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode;
  align?: 'left' | 'center' | 'right';
  variant?: 'head' | 'body';
}

export function TableCell({ children, align = 'left', variant = 'body', className, ...props }: TableCellProps) {
  const Element = variant === 'head' ? 'th' : 'td';
  return (
    <Element
      className={`${styles.cell} ${styles[align]} ${className ?? ''}`}
      {...props}
    >
      {children}
    </Element>
  );
}
