import { Clock } from 'lucide-react';
import styles from '../GraphCanvas.module.css';

interface Props {
  durationMs?: number | null;
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

export function TurnNodeDuration({ durationMs }: Props) {
  if (!durationMs || durationMs <= 0) return null;
  return (
    <span className={styles.cost} title={`Turn duration: ${durationMs}ms`}>
      <Clock size={10} /> {fmt(durationMs)}
    </span>
  );
}
