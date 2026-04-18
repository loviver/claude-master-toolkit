import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { TimelinePoint } from '../../lib/types';
import { formatTokens, formatCost } from '../../lib/format';
import { chartTooltipStyle, chartAxisStyle, chartGridStyle, gradientId } from './chartTheme';

interface Props {
  data: TimelinePoint[];
  height?: number;
  showCost?: boolean;
}

const SERIES = [
  { key: 'inputTokens',     name: 'Input',      color: 'var(--chart-1)' },
  { key: 'outputTokens',    name: 'Output',     color: 'var(--chart-2)' },
  { key: 'cacheReadTokens', name: 'Cache Read', color: 'var(--chart-3)' },
] as const;

export function TokenTimelineChart({ data, height = 280, showCost = false }: Props) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <defs>
            {SERIES.map((s) => (
              <linearGradient key={s.key} id={gradientId('tl', s.key)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid {...chartGridStyle} />
          <XAxis dataKey="date" {...chartAxisStyle} />
          <YAxis {...chartAxisStyle} tickFormatter={(v) => formatTokens(v)} />
          <Tooltip
            contentStyle={chartTooltipStyle}
            formatter={(value: number, name) =>
              name === 'Cost' ? formatCost(value) : formatTokens(value)
            }
          />
          <Legend wrapperStyle={{ fontSize: 'var(--text-xs)', paddingTop: 12 }} />
          {SERIES.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              fill={`url(#${gradientId('tl', s.key)})`}
              strokeWidth={2}
            />
          ))}
          {showCost && (
            <Area
              type="monotone"
              dataKey="costUsd"
              name="Cost"
              stroke="var(--chart-4)"
              fill="transparent"
              strokeWidth={2}
              strokeDasharray="4 4"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
