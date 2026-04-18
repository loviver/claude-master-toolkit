import type { StopReason } from '../../../../lib/types';

export interface StopReasonMeta {
  icon: string;
  label: string;
  color: string;
}

const MAP: Record<string, StopReasonMeta> = {
  tool_use:      { icon: '⚙', label: 'tool_use',   color: 'var(--color-info, #3b82f6)' },
  end_turn:      { icon: '◀', label: 'end_turn',   color: 'var(--color-success, #16a34a)' },
  max_tokens:    { icon: '⚠', label: 'max_tokens', color: 'var(--color-warn, #d97706)' },
  stop_sequence: { icon: '■', label: 'stop_seq',   color: 'var(--text-muted)' },
};

export function stopReasonMeta(reason: StopReason | null | undefined): StopReasonMeta | null {
  if (!reason) return null;
  return MAP[reason] ?? { icon: '?', label: String(reason), color: 'var(--text-muted)' };
}
