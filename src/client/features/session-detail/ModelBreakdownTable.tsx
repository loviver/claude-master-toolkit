import type { ModelBreakdownEntry } from '../../lib/types';
import { Badge, modelBadgeVariant, DataTable } from '../../components/ui';
import { formatCost, formatTokens, shortModel } from '../../lib/format';

interface Row {
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

interface Props {
  breakdown: Record<string, ModelBreakdownEntry>;
}

export function ModelBreakdownTable({ breakdown }: Props) {
  const rows: Row[] = Object.entries(breakdown).map(([model, data]) => ({ model, ...data }));

  const columns = [
    {
      key: 'model',
      header: 'Model',
      render: (r: Row) => <Badge variant={modelBadgeVariant(r.model)}>{shortModel(r.model)}</Badge>,
    },
    { key: 'turns',      header: 'Turns',      align: 'right' as const, render: (r: Row) => r.turns },
    { key: 'input',      header: 'Input',      align: 'right' as const, render: (r: Row) => formatTokens(r.inputTokens) },
    { key: 'output',     header: 'Output',     align: 'right' as const, render: (r: Row) => formatTokens(r.outputTokens) },
    { key: 'cacheRead',  header: 'Cache Read', align: 'right' as const, render: (r: Row) => formatTokens(r.cacheReadTokens) },
    {
      key: 'cost',
      header: 'Cost',
      align: 'right' as const,
      render: (r: Row) => <span style={{ color: 'var(--accent-amber)' }}>{formatCost(r.costUsd)}</span>,
    },
  ];

  return <DataTable columns={columns} data={rows} keyFn={(r) => r.model} />;
}
