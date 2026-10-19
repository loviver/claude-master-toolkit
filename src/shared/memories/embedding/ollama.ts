import type { Embedder } from './port.js';

/**
 * Ollama embedder — zero bundled weight, offline if the user runs Ollama locally.
 * Default model `nomic-embed-text`. Throws on connection/HTTP failure (caller degrades to keyword).
 */
export function createOllamaEmbedder(
  endpoint = 'http://localhost:11434',
  model = 'nomic-embed-text',
): Embedder {
  let dim = 0;
  return {
    id: `ollama:${model}`,
    get dim() {
      return dim;
    },
    async embed(texts: string[]): Promise<Float32Array[]> {
      const out: Float32Array[] = [];
      for (const t of texts) {
        const res = await fetch(`${endpoint.replace(/\/$/, '')}/api/embeddings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, prompt: t }),
        });
        if (!res.ok) throw new Error(`ollama embeddings HTTP ${res.status}`);
        const json = (await res.json()) as { embedding: number[] };
        const vec = Float32Array.from(json.embedding);
        dim = vec.length;
        out.push(vec);
      }
      return out;
    },
  };
}
