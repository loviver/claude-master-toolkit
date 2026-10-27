import { ctkPaths } from '../../paths/ctk-home.js';
import { mkdirSync } from 'fs';
import type { Embedder } from './port.js';
import { loadTransformers, formatModelProgress } from './transformers-ext.js';

/**
 * Local, offline embedder backed by transformers.js (`@huggingface/transformers`).
 * The model (~110MB, multilingual) is downloaded once, then fully offline.
 *
 * The package is NOT a dependency: `ctk mem semantic enable` installs it into `~/.ctk/ext` (see
 * transformers-ext.ts). When it is missing, loading throws TransformersMissingError and recall
 * degrades to keyword-only upstream.
 */

/** Writable model cache. transformers.js otherwise defaults to a `.cache` INSIDE its own package
 * dir — which is root-owned under a global npm install → EACCES. Override to a user dir. */
function resolveModelCacheDir(): string {
  const dir =
    process.env['CTK_MODEL_CACHE'] ??
    process.env['HF_HOME'] ??
    ctkPaths.modelsCache();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function createLocalEmbedder(
  model: string,
  opts: { allowRemoteModels?: boolean } = {},
): Promise<Embedder> {
  // Only an explicit reindex may download the ~110MB model. Recall/save pass
  // false so a missing/partial cache throws FAST (→ keyword fallback) instead
  // of blocking the query on a multi-minute download.
  const allowRemoteModels = opts.allowRemoteModels ?? true;
  const mod: any = await loadTransformers();
  if (mod.env) {
    mod.env.cacheDir = resolveModelCacheDir();
    mod.env.allowRemoteModels = allowRemoteModels;
    mod.env.useBrowserCache = false;
  }
  // A download only happens on reindex: surface progress so the ~110MB fetch never looks frozen.
  const progress_callback = allowRemoteModels
    ? (ev: unknown) => {
        const line = formatModelProgress(ev);
        if (line) process.stderr.write(`\r${line}`);
      }
    : undefined;
  const extractor = await mod.pipeline('feature-extraction', model, { progress_callback });
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
