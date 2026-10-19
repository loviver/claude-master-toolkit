import type { Embedder } from './port.js';
import type { EmbedderConfig } from './index.js';

/**
 * OpenAI-compatible embeddings API adapter (OpenAI, Voyage via base URL, etc.).
 * Best quality, but needs a key + network — not offline. Opt-in via `embedder=api`.
 */
export function createApiEmbedder(cfg: EmbedderConfig): Embedder {
  const model = cfg.model ?? 'text-embedding-3-small';
  const endpoint = cfg.endpoint ?? 'https://api.openai.com/v1/embeddings';
  const key = cfg.apiKey;
  if (!key) {
    throw new Error('api embedder requires a key (CTK_EMBED_API_KEY or OPENAI_API_KEY)');
  }
  let dim = 0;
  return {
    id: `api:${model}`,
    get dim() {
      return dim;
    },
    async embed(texts: string[]): Promise<Float32Array[]> {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) throw new Error(`embeddings API HTTP ${res.status}`);
      const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
      return json.data.map((d) => {
        const vec = Float32Array.from(d.embedding);
        dim = vec.length;
        return vec;
      });
    },
  };
}
