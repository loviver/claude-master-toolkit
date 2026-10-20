import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import type { Embedder } from './port.js';

/**
 * Local, offline embedder backed by transformers.js (`@huggingface/transformers`).
 * The model (~110MB, multilingual) is downloaded once, then fully offline.
 *
 * The package is an OPTIONAL runtime dependency: it is imported via a variable specifier so the
 * toolkit builds and runs (keyword-only) even when it is not installed. Only `embedder=local`
 * pulls it in; failure to load degrades to keyword recall upstream.
 */

/** Writable model cache. transformers.js otherwise defaults to a `.cache` INSIDE its own package
 * dir — which is root-owned under a global npm install → EACCES. Override to a user dir. */
function resolveModelCacheDir(): string {
  const dir =
    process.env['CTK_MODEL_CACHE'] ??
    process.env['HF_HOME'] ??
    join(homedir(), '.claude', 'state', 'claude-master-toolkit', 'models');
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
  const pkg = '@huggingface/transformers';
  const mod: any = await import(pkg);
  if (mod.env) {
    mod.env.cacheDir = resolveModelCacheDir();
    mod.env.allowRemoteModels = allowRemoteModels;
    mod.env.useBrowserCache = false;
  }
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
