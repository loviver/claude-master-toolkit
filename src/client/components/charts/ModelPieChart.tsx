import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import type { ModelStats } from '../../lib/types';
import { MODEL_COLOR } from '../../lib/model-colors';
import { formatCost, formatPercent } from '../../lib/format';
import { chartTooltipStyle } from './chartTheme';

interface Props {
  data: ModelStats[];
  height?: number;
  valueKey?: 'costUsd' | 'turns';
}

export function ModelPieChart({ data, height = 280, valueKey = 'costUsd' }: Props) {
  const chartData = data.map((d) => ({
    name: d.modelKey,
    value: valueKey === 'costUsd' ? Number(d.costUsd.toFixed(4)) : d.turns,
    pct: d.percentage,
  }));

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            stroke="var(--bg-surface)"
            label={({ name, pct }) => `${name} · ${formatPercent(pct)}`}
          >
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={MODEL_COLOR[entry.name as keyof typeof MODEL_COLOR] ?? 'var(--model-unknown)'} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={chartTooltipStyle}
            formatter={(value: number) => (valueKey === 'costUsd' ? formatCost(value) : `${value} turns`)}
          />
          <Legend wrapperStyle={{ fontSize: 'var(--text-xs)', paddingTop: 8 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
