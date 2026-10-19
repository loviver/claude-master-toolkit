/**
 * Embedder port. Adapters: local (transformers.js, offline), ollama, api. Any adapter that
 * cannot initialise resolves to `null` upstream so recall silently degrades to keyword-only.
 */
export interface Embedder {
  /** Stable identity, e.g. "local:paraphrase-multilingual-MiniLM-L12-v2". Stored per vector. */
  readonly id: string;
  /** Embedding dimensionality (may be 0 until the first embed call for lazy adapters). */
  readonly dim: number;
  /** Embed a batch of texts into dense vectors (one per input, same order). */
  embed(texts: string[]): Promise<Float32Array[]>;
}
