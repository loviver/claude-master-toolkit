import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchApi, ApiError } from '../api';

const originalFetch = globalThis.fetch;

describe('fetchApi', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('aborta tras timeout configurado', async () => {
    globalThis.fetch = vi.fn((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal!;
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as any;

    const promise = fetchApi('/sessions', { timeoutMs: 100 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(150);
    const err = await promise;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });

  it('lanza ApiError con status y body en respuesta no-ok', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any;
    const err = await fetchApi('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).body).toContain('boom');
  });

  it('devuelve JSON parseado en 200', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as any;
    const data = await fetchApi<{ ok: boolean }>('/ok');
    expect(data.ok).toBe(true);
  });
});
