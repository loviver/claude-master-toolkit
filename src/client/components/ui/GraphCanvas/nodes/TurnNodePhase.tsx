import type { Phase, StopReason } from '../../../../lib/types';
import { PHASE_COLOR } from '../../../../lib/model-colors';
import { stopReasonMeta } from '../lib/stopReason';
import styles from '../GraphCanvas.module.css';

interface Props {
  phase: Phase;
  stopReason: StopReason | null;
}

export function TurnNodePhase({ phase, stopReason }: Props) {
  if (phase && phase !== 'unknown') {
    return (
      <div className={styles.phase} style={{ color: PHASE_COLOR[phase] }}>{phase}</div>
    );
  }
  const meta = stopReasonMeta(stopReason);
  const label = meta?.label ?? 'init';
  const color = meta?.color ?? 'var(--text-muted)';
  return <div className={styles.phase} style={{ color }}>{label}</div>;
}
