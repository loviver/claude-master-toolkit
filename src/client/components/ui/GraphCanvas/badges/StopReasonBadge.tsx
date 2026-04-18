import { stopReasonMeta } from '../lib/stopReason';
import type { StopReason } from '../../../../lib/types';
import styles from '../GraphCanvas.module.css';

interface Props {
  reason: StopReason | null | undefined;
}

export function StopReasonBadge({ reason }: Props) {
  const meta = stopReasonMeta(reason);
  if (!meta) return null;
  return (
    <span
      className={styles.stopBadge}
      style={{ color: meta.color, borderColor: meta.color }}
      aria-label={meta.label}
      title={meta.label}
    >
      {meta.icon}
    </span>
  );
}
