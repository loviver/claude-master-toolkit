const DAY_MS = 86_400_000;

export function rangeToCutoff(range?: string): number | null {
  switch (range) {
    case '1d':  return Date.now() - DAY_MS;
    case '7d':  return Date.now() - 7 * DAY_MS;
    case '30d': return Date.now() - 30 * DAY_MS;
    case '90d': return Date.now() - 90 * DAY_MS;
    default:    return null;
  }
}
