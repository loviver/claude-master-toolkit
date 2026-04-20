import type { ModelBreakdownEntry } from '../../../lib/types';
import { ModelRow, type ModelRowData } from './ModelRow';
import styles from './ModelBreakdownTable.module.css';

interface ModelBreakdownTableProps {
  breakdown: Record<string, ModelBreakdownEntry>;
}

export function ModelBreakdownTable({ breakdown }: ModelBreakdownTableProps) {
  const rows: ModelRowData[] = Object.entries(breakdown).map(([model, d]) => ({ model, ...d }));
  const maxTokens = rows.reduce(
    (max, r) => Math.max(max, r.inputTokens + r.outputTokens + r.cacheReadTokens),
    0,
  );

  if (rows.length === 0) return <p className={styles.empty}>No model activity</p>;

  return (
    <div className={styles.list}>
      {rows.map((r) => (
        <ModelRow key={r.model} row={r} maxTokens={maxTokens} />
      ))}
    </div>
  );
}
