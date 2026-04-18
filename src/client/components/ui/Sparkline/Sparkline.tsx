import { useMemo } from 'react';
import styles from './Sparkline.module.css';

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}

export function Sparkline({ values, width = 96, height = 28, color = 'var(--accent-claude)', fill = true }: SparklineProps) {
  const { path, area } = useMemo(() => {
    if (values.length === 0) return { path: '', area: '' };
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const step = values.length > 1 ? width / (values.length - 1) : width;
    const points = values.map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return [x, y] as const;
    });
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const areaPath = `${line} L${(points.at(-1)?.[0] ?? 0).toFixed(1)},${height} L0,${height} Z`;
    return { path: line, area: areaPath };
  }, [values, width, height]);

  if (!path) return <span className={styles.empty}>—</span>;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={styles.svg}>
      {fill && <path d={area} fill={color} opacity={0.12} />}
      <path d={path} stroke={color} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
