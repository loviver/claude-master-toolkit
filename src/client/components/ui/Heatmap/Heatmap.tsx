import { useMemo } from 'react';
import styles from './Heatmap.module.css';

interface HeatmapPoint {
  dow: number;   // 0 = Sun, 6 = Sat
  hour: number;  // 0..23
  value: number;
}

interface HeatmapProps {
  data: HeatmapPoint[];
  label?: (p: HeatmapPoint) => string;
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function Heatmap({ data, label }: HeatmapProps) {
  const { max, grid } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    let m = 0;
    for (const p of data) {
      if (p.dow < 0 || p.dow > 6 || p.hour < 0 || p.hour > 23) continue;
      g[p.dow][p.hour] = p.value;
      if (p.value > m) m = p.value;
    }
    return { max: m, grid: g };
  }, [data]);

  const opacityOf = (v: number) => (max === 0 ? 0 : Math.max(0.04, Math.min(1, v / max)));

  return (
    <div className={styles.wrapper}>
      <div className={styles.hoursRow}>
        <div />
        {Array.from({ length: 24 }).map((_, h) => (
          <div key={h} className={styles.hourLabel}>{h % 6 === 0 ? h : ''}</div>
        ))}
      </div>
      {grid.map((row, dow) => (
        <div key={dow} className={styles.row}>
          <div className={styles.dowLabel}>{DOW_LABELS[dow]}</div>
          {row.map((v, hour) => {
            const title = label?.({ dow, hour, value: v }) ?? `${DOW_LABELS[dow]} ${hour}:00 — ${v}`;
            return (
              <div
                key={hour}
                className={styles.cell}
                style={{ backgroundColor: `color-mix(in srgb, var(--accent-claude) ${Math.round(opacityOf(v) * 100)}%, var(--bg-muted))` }}
                title={title}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
