import { Badge, modelBadgeVariant } from '../../../../components/ui';
import { formatCost, formatTokens, shortModel } from '../../../../lib/format';
import { colorForModel } from '../../../../lib/model-colors';
import styles from './ModelRow.module.css';

export interface ModelRowData {
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

interface ModelRowProps {
  row: ModelRowData;
  maxTokens: number;
}

export function ModelRow({ row, maxTokens }: ModelRowProps) {
  const total = row.inputTokens + row.outputTokens + row.cacheReadTokens;
  const pct = maxTokens > 0 ? (total / maxTokens) * 100 : 0;

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <Badge variant={modelBadgeVariant(row.model)}>{shortModel(row.model)}</Badge>
        <span className={styles.turns}>{row.turns} turns</span>
        <span className={styles.cost}>{formatCost(row.costUsd)}</span>
      </div>
      <div className={styles.barTrack}>
        <div
          className={styles.bar}
          style={{ width: `${pct}%`, background: colorForModel(row.model) }}
        />
      </div>
      <div className={styles.tokens}>
        <span><em>in</em> {formatTokens(row.inputTokens)}</span>
        <span><em>out</em> {formatTokens(row.outputTokens)}</span>
        <span><em>cache</em> {formatTokens(row.cacheReadTokens)}</span>
      </div>
    </div>
  );
}
