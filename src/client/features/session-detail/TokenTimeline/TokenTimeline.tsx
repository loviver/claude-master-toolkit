import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { TokenEvent } from '../../../lib/types';
import { formatTokens, formatCost } from '../../../lib/format';
import { chartTooltipStyle, chartAxisStyle, chartGridStyle, gradientId } from '../../../components/charts/chartTheme';
import { useTokenTimelineData } from '../../../hooks/useTokenTimelineData';
import { TimelineLegend } from './TimelineLegend';
import { TimelineStrip } from './TimelineStrip';
import styles from './TokenTimeline.module.css';

interface TokenTimelineProps {
  events: TokenEvent[];
}

const SERIES = [
  { key: 'input',  name: 'Input',       color: 'var(--chart-1)' },
  { key: 'output', name: 'Output',      color: 'var(--chart-2)' },
  { key: 'cacheR', name: 'Cache Read',  color: 'var(--chart-3)' },
  { key: 'cacheW', name: 'Cache Write', color: 'var(--chart-4)' },
] as const;

export function TokenTimeline({ events }: TokenTimelineProps) {
  const { data, segments, uniqueModels } = useTokenTimelineData(events);
  if (events.length === 0) return <p className={styles.empty}>No turns recorded</p>;

  return (
    <div className={styles.timeline}>
      <TimelineLegend models={uniqueModels} />
      <TimelineStrip segments={segments} />
      <div className={styles.chartWrap}>
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
