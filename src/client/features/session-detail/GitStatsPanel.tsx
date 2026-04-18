import { Plus, Minus, FileCode } from 'lucide-react';
import type { GitStats } from '../../lib/types';
import { Grid, MetricTile } from '../../components/ui';

interface Props {
  stats: GitStats;
}

export function GitStatsPanel({ stats }: Props) {
  return (
    <Grid cols={3} minItemWidth={180}>
      <MetricTile icon={Plus} tone="green" label="Insertions" value={`+${stats.insertions}`} />
      <MetricTile icon={Minus} tone="red" label="Deletions" value={`-${stats.deletions}`} />
      <MetricTile icon={FileCode} tone="blue" label="Files Changed" value={stats.filesChanged} />
    </Grid>
  );
}
