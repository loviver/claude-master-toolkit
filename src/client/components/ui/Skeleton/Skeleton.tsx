import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: 'sm' | 'md' | 'full';
  className?: string;
}

export function Skeleton({ width, height = 16, radius = 'sm', className }: SkeletonProps) {
  const style: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  };
  return <div className={`${styles.skeleton} ${styles[radius]} ${className ?? ''}`} style={style} />;
}

interface SkeletonGridProps {
  count: number;
  height?: number;
}

export function SkeletonGrid({ count, height = 80 }: SkeletonGridProps) {
  return (
    <div className={styles.grid}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={height} radius="md" />
      ))}
    </div>
  );
}
