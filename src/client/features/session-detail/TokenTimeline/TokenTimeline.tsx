import {
  AreaChart, Area, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
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

/** Stacked parts of the context window billed each turn. */
const CONTEXT_SERIES = [
  { key: 'cacheR', name: 'Cache read',  color: 'var(--chart-3)' },
  { key: 'cacheW', name: 'Cache write', color: 'var(--chart-5)' },
  { key: 'input',  name: 'Uncached',    color: 'var(--chart-1)' },
] as const;

export function TokenTimeline({ events }: TokenTimelineProps) {
  const { data, segments, uniqueModels } = useTokenTimelineData(events);
  if (events.length === 0) return <p className={styles.empty}>No turns recorded</p>;

  return (
    <div className={styles.timeline}>
      {uniqueModels.length > 1 && (
        <>
          <TimelineLegend models={uniqueModels} />
          <TimelineStrip segments={segments} />
        </>
      )}

      <h3 className={styles.chartTitle}>Context per turn</h3>
      <div className={styles.chartWrap}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <defs>
              {CONTEXT_SERIES.map((s) => (
                <linearGradient key={s.key} id={gradientId('sd', s.key)} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid {...chartGridStyle} />
            <XAxis dataKey="turn" {...chartAxisStyle} />
            <YAxis {...chartAxisStyle} tickFormatter={(v) => formatTokens(v)} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value: number) => formatTokens(value)}
              labelFormatter={(label) => `Turn ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: 'var(--text-xs)', paddingTop: 8 }} />
            {CONTEXT_SERIES.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stackId="context"
                stroke={s.color}
                fill={`url(#${gradientId('sd', s.key)})`}
                strokeWidth={1.5}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <h3 className={styles.chartTitle}>Cost &amp; output per turn</h3>
      <div className={styles.chartWrapShort}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid {...chartGridStyle} />
            <XAxis dataKey="turn" {...chartAxisStyle} />
            <YAxis yAxisId="cost" {...chartAxisStyle} tickFormatter={(v) => formatCost(v)} />
            <YAxis yAxisId="out" orientation="right" {...chartAxisStyle} tickFormatter={(v) => formatTokens(v)} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value: number, name) => (name === 'Cost' ? formatCost(value, 4) : formatTokens(value))}
              labelFormatter={(label) => `Turn ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: 'var(--text-xs)', paddingTop: 8 }} />
            <Bar yAxisId="cost" dataKey="cost" name="Cost" fill="var(--chart-4)" />
            <Line yAxisId="out" type="monotone" dataKey="output" name="Output" stroke="var(--chart-2)" dot={false} strokeWidth={1.5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
