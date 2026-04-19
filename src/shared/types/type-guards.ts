// ── Reusable type guards ──

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isArray<T = unknown>(v: unknown): v is T[] {
  return Array.isArray(v);
}

export function isString(v: unknown): v is string {
  return typeof v === 'string';
}

export function isNumber(v: unknown): v is number {
  return typeof v === 'number';
}

export function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

export function hasProperty<K extends PropertyKey>(v: unknown, k: K): v is Record<K, unknown> {
  return isRecord(v) && k in v;
}

export function hasProperties<K extends PropertyKey>(v: unknown, ...keys: K[]): v is Record<K, unknown> {
  return isRecord(v) && keys.every((k) => k in v);
}

export function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    isRecord(v) &&
    Object.entries(v).every(([_k, val]) => typeof val === 'string')
  );
}

export function isNumberRecord(v: unknown): v is Record<string, number> {
  return (
    isRecord(v) &&
    Object.entries(v).every(([_k, val]) => typeof val === 'number')
  );
}
