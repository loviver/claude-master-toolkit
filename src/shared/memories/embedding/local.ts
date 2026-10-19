import type { Embedder } from './port.js';

/**
 * Local, offline embedder backed by transformers.js (`@huggingface/transformers`).
 * The model (~110MB, multilingual) is downloaded once and cached under the HF cache dir.
 *
 * The package is an OPTIONAL runtime dependency: it is imported via a variable specifier so the
 * toolkit builds and runs (keyword-only) even when it is not installed. Only `embedder=local`
 * pulls it in; failure to load degrades to keyword recall upstream.
 */
export async function createLocalEmbedder(model: string): Promise<Embedder> {
  const pkg = '@huggingface/transformers';
  const mod: any = await import(pkg);
  const extractor = await mod.pipeline('feature-extraction', model);
  let dim = 0;

  return {
    id: `local:${model}`,
    get dim() {
      return dim;
    },
    async embed(texts: string[]): Promise<Float32Array[]> {
      const out: Float32Array[] = [];
      for (const t of texts) {
        const res = await extractor(t, { pooling: 'mean', normalize: true });
        const vec = Float32Array.from(res.data as ArrayLike<number>);
        dim = vec.length;
        out.push(vec);
      }
      return out;
    },
  };
}
