/**
 * Recharts theming helpers — keeps chart components free of hardcoded hex.
 */

export const chartTooltipStyle = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2) var(--space-3)',
  fontSize: 'var(--text-xs)',
  boxShadow: 'var(--shadow-md)',
  color: 'var(--text-primary)',
};

export const chartAxisStyle = {
  stroke: 'var(--border)',
  fontSize: 11,
  fill: 'var(--text-muted)',
};

export const chartGridStyle = {
  stroke: 'var(--border-subtle)',
  strokeDasharray: '2 4',
};

export function gradientId(prefix: string, key: string): string {
  return `grad-${prefix}-${key}`;
}
