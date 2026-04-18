import { Wrench } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useToolStats, useToolEfficiency, useProjects } from '../../hooks/queries/useStats';
import { useFilters } from '../../lib/filters';
import {
  PageHeader, FilterBar, Card, CardHeader, CardTitle, CardContent, DataTable,
  EmptyState, Skeleton,
} from '../../components/ui';
import { chartTooltipStyle, chartAxisStyle, chartGridStyle } from '../../components/charts/chartTheme';
import { formatCost } from '../../lib/format';
import styles from './Tools.module.css';

interface Row {
  tool: string;
  count: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCostUsd: number;
}

const columns = [
  { key: 'tool',    header: 'Tool',         render: (r: Row) => <span className={styles.tool}>{r.tool}</span> },
  { key: 'count',   header: 'Uses',         align: 'right' as const, render: (r: Row) => r.count },
  { key: 'avgIn',   header: 'Avg Input',    align: 'right' as const, render: (r: Row) => r.avgInputTokens.toLocaleString() },
  { key: 'avgOut',  header: 'Avg Output',   align: 'right' as const, render: (r: Row) => r.avgOutputTokens.toLocaleString() },
  { key: 'avgCost', header: 'Avg Cost',     align: 'right' as const, render: (r: Row) => <span className={styles.cost}>{formatCost(r.avgCostUsd)}</span> },
];

export function Tools() {
  const { filters } = useFilters();
  const { data: projects } = useProjects(filters);
  const { data: tools, isLoading: loadingTools } = useToolStats(filters);
  const { data: efficiency, isLoading: loadingEff } = useToolEfficiency(filters);

  const loading = loadingTools || loadingEff;

  return (
    <div className={styles.page}>
      <PageHeader icon={Wrench} title="Tool Analytics" description="Usage frequency, cost per tool and common combos" />
      <FilterBar projects={projects ?? []} />

      {loading ? (
        <Skeleton height={400} radius="md" />
      ) : !tools || Object.keys(tools.frequency).length === 0 ? (
        <Card>
          <EmptyState icon={Wrench} title="No tool data yet" />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>Usage Frequency</CardTitle></CardHeader>
            <CardContent>
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <BarChart
                    data={Object.entries(tools.frequency).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([tool, count]) => ({ tool, count }))}
                    layout="vertical"
                    margin={{ left: 60, right: 16 }}
                  >
                    <CartesianGrid {...chartGridStyle} horizontal={false} />
                    <XAxis type="number" {...chartAxisStyle} />
                    <YAxis type="category" dataKey="tool" {...chartAxisStyle} width={80} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {efficiency && Object.keys(efficiency.perTool).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Cost per Tool</CardTitle></CardHeader>
              <CardContent>
                <DataTable
                  columns={columns}
                  data={Object.entries(efficiency.perTool).map(([tool, stats]) => ({ tool, ...stats }))}
                  keyFn={(r) => r.tool}
                />
              </CardContent>
            </Card>
          )}

          {tools.combos.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Common Combos</CardTitle></CardHeader>
              <CardContent>
                <DataTable
                  columns={[
                    { key: 'tools', header: 'Tools', render: (r: { tools: string[]; count: number }) => <span className={styles.tool}>{r.tools.join(' + ')}</span> },
                    { key: 'count', header: 'Count', align: 'right' as const, render: (r: { tools: string[]; count: number }) => r.count },
                  ]}
                  data={tools.combos}
                  keyFn={(r) => r.tools.join(',')}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
