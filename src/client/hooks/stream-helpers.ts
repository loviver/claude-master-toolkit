const SEP = '\x1f';

function tagSegment(v: unknown): string {
  if (v === null) return 'n';
  if (v === undefined) return 'u';
  if (typeof v === 'string') return `s:${v}`;
  if (typeof v === 'number') return `d:${v}`;
  if (typeof v === 'boolean') return `b:${v ? 1 : 0}`;
  return `j:${JSON.stringify(v)}`;
}

export function stableQueryKey(key: readonly unknown[]): string {
  return key.map(tagSegment).join(SEP);
}

const BASE_MS = 1000;
const MAX_MS = 30_000;

export function backoffDelay(attempt: number): number {
  const raw = BASE_MS * 2 ** attempt;
  return Math.min(raw, MAX_MS);
}
