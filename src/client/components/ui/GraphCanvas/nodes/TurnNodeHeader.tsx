import type { ModelKey, StopReason } from '../../../../lib/types';
import { MODEL_COLOR } from '../../../../lib/model-colors';
import { StopReasonBadge } from '../badges/StopReasonBadge';
import { formatCost } from '../lib/formatters';
import styles from '../GraphCanvas.module.css';

interface Props {
  label: string;
  modelKey: ModelKey;
  stopReason: StopReason | null;
  costUsd: number;
}

export function TurnNodeHeader({ label, modelKey, stopReason, costUsd }: Props) {
  const color = MODEL_COLOR[modelKey];
  const cost = formatCost(costUsd);
  return (
    <div className={styles.nodeHeader}>
      <span className={styles.dot} style={{ background: color }} />
      <span className={styles.nodeLabel}>{label}</span>
      <StopReasonBadge reason={stopReason} />
      {cost && <span className={styles.cost}>{cost}</span>}
    </div>
  );
}
