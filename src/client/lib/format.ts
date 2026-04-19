/**
 * Formatting helpers — keep UI components token-math free.
 */

export function formatTokens(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function formatCost(n: number | null | undefined, digits = 4): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (n >= 1000) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(digits)}`;
}

export function formatCompactCost(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  if (n >= 10) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

export function formatPercent(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return 'in future';
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function formatDate(ms: number, withTime = false): string {
  const d = new Date(ms);
  if (withTime) return d.toLocaleString();
  return d.toLocaleDateString();
}

export function formatProjectName(path: string): string {
  if (path.includes('/')) {
    return path.split('/').filter(Boolean).at(-1) ?? path;
  }
  const segs = path.split('-').filter(Boolean);
  return segs.at(-1) ?? path;
}

export function shortModel(model: string): string {
  return model.replace('claude-', '').replace(/-\d{8}$/, '');
}
