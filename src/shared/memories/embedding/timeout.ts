/**
 * Timeout guard for embedding operations.
 *
 * Why this exists: recall must NEVER hang. The local embedder can stall on a
 * first/partial model download; the ollama/api embedders can stall on an
 * unreachable endpoint. `resolveEmbedder`'s try/catch only degrades on a THROW,
 * not on a HANG — so an un-timed-out await blocks recall forever. Wrapping the
 * resolve + query-embed in `withTimeout` turns a hang into a rejection, which
 * the callers already degrade to keyword-only.
 */

export const DEFAULT_EMBED_TIMEOUT_MS = 5000;

/** Recall-side embed budget. Override with CTK_EMBED_TIMEOUT_MS. */
export function embedTimeoutMs(): number {
  const raw = Number(process.env['CTK_EMBED_TIMEOUT_MS']);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EMBED_TIMEOUT_MS;
}

/**
 * Race a promise against a timer. Rejects with a timeout error if `p` does not
 * settle within `ms`. The timer is `unref`'d so a still-pending `p` never keeps
 * the process alive (important for the CLI, which exits right after output).
 */
export async function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
