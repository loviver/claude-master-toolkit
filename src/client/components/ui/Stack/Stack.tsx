import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import styles from './Stack.module.css';

type Gap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8;

interface StackProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  direction?: 'row' | 'col';
  gap?: Gap;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  wrap?: boolean;
}

export function Stack({
  children,
  direction = 'col',
  gap = 3,
  align,
  justify,
  wrap,
  className,
  style,
  ...rest
}: StackProps) {
  const cssStyle: CSSProperties = {
    gap: `var(--space-${gap})`,
    alignItems: align,
    justifyContent: justify === 'between' ? 'space-between' : justify === 'around' ? 'space-around' : justify,
    flexWrap: wrap ? 'wrap' : undefined,
    ...style,
  };
  return (
    <div
      className={`${styles.stack} ${direction === 'row' ? styles.row : styles.col} ${className ?? ''}`}
      style={cssStyle}
      {...rest}
    >
      {children}
    </div>
  );
}

interface GridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  cols?: number;
  minItemWidth?: number;
  gap?: Gap;
}

export function Grid({ children, cols, minItemWidth = 240, gap = 4, className, style, ...rest }: GridProps) {
  const cssStyle: CSSProperties = {
    gap: `var(--space-${gap})`,
    gridTemplateColumns: cols ? `repeat(${cols}, minmax(0, 1fr))` : `repeat(auto-fit, minmax(${minItemWidth}px, 1fr))`,
    ...style,
  };
  return (
    <div className={`${styles.grid} ${className ?? ''}`} style={cssStyle} {...rest}>
      {children}
    </div>
  );
}
