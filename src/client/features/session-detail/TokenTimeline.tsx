import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { TokenEvent } from '../../lib/types';
import { formatTokens, formatCost, shortModel } from '../../lib/format';
import { colorForModel } from '../../lib/model-colors';
import { chartTooltipStyle, chartAxisStyle, chartGridStyle, gradientId } from '../../components/charts/chartTheme';
import styles from './SessionDetail.module.css';

interface Props {
  events: TokenEvent[];
}

const SERIES = [
  { key: 'input',    name: 'Input',      color: 'var(--chart-1)' },
  { key: 'output',   name: 'Output',     color: 'var(--chart-2)' },
  { key: 'cacheR',   name: 'Cache Read', color: 'var(--chart-3)' },
  { key: 'cacheW',   name: 'Cache Write',color: 'var(--chart-4)' },
] as const;

export function TokenTimeline({ events }: Props) {
  if (events.length === 0) return <p className={styles.empty}>No turns recorded</p>;

  const data = events.map((e, i) => ({
    turn: i + 1,
    model: e.model,
    timestamp: e.timestamp,
    input: e.inputTokens,
    output: e.outputTokens,
    cacheR: e.cacheReadTokens,
    cacheW: e.cacheCreationTokens,
    cost: Number(e.costUsd.toFixed(6)),
  }));

  const uniqueModels = [...new Set(events.map((e) => e.model))];
  const segments: Array<{ model: string; start: number; end: number }> = [];
  for (let i = 0; i < events.length; i++) {
    const m = events[i].model;
    const last = segments[segments.length - 1];
    if (!last || last.model !== m) segments.push({ model: m, start: i, end: i });
    else last.end = i;
  }

  return (
    <div className={styles.timeline}>
      <div className={styles.legend}>
        {uniqueModels.map((m) => (
          <span key={m} className={styles.legendItem}>
            <span className={styles.dot} style={{ background: colorForModel(m) }} />
            {shortModel(m)}
          </span>
        ))}
      </div>

      <div className={styles.strip}>
        {segments.map((s, i) => (
          <div
            key={i}
            className={styles.stripSeg}
            style={{ flex: s.end - s.start + 1, background: colorForModel(s.model) }}
            title={`${shortModel(s.model)} · turns ${s.start + 1}–${s.end + 1}`}
          />
        ))}
      </div>

      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <defs>
              {SERIES.map((s) => (
                <linearGradient key={s.key} id={gradientId('sd', s.key)} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid {...chartGridStyle} />
            <XAxis dataKey="turn" {...chartAxisStyle} label={{ value: 'Turn', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }} />
            <YAxis {...chartAxisStyle} tickFormatter={(v) => formatTokens(v)} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value: number, name) => (name === 'Cost' ? formatCost(value, 4) : formatTokens(value))}
              labelFormatter={(label) => `Turn ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: 'var(--text-xs)', paddingTop: 8 }} />
            {SERIES.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                fill={`url(#${gradientId('sd', s.key)})`}
                strokeWidth={1.5}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
