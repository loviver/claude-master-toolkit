const BASE = '/api';
const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(public status: number, public body: string, message?: string) {
    super(message ?? `API ${status}: ${body || 'request failed'}`);
    this.name = 'ApiError';
  }
}

export type ApiInit = RequestInit & { timeoutMs?: number };

export async function fetchApi<T>(path: string, init?: ApiInit): Promise<T> {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') throw new ApiError(0, '', `API timeout after ${timeoutMs}ms`);
    throw new ApiError(0, String(err?.message ?? err), `API network error: ${err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function toQueryString(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '' || v === 'all') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}
