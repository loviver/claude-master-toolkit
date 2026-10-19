import type Database from 'better-sqlite3';
import type { RecallInput, RecallRow, MemoryRow } from './types.js';
import { recall } from './search.js';
import { rowById } from './crud.js';
import { cosineSimilarity } from './vector.js';
import { reciprocalRankFusion } from './fusion.js';
import { loadCandidateVectors } from './embedding/index.js';
import type { Embedder } from './embedding/port.js';

export type RecallMode = 'hybrid' | 'keyword' | 'semantic';

export interface HybridOptions {
  embedder?: Embedder | null;
  mode?: RecallMode;
}

/**
 * Hybrid recall = keyword leg (FTS5/BM25) fused with a dense-vector leg (cosine) via RRF.
 *
 * The keyword leg runs first and always (it also logs the search + applies filters), so hybrid
 * is a strict superset of `recall()`: with no embedder, `mode='keyword'`, or any embedder error,
 * it returns exactly the keyword results. The vector leg is what rescues paraphrase/cross-language
 * queries (the "créditos IA" vs "ai credits" miss).
 */
export async function recallHybrid(
  db: Database.Database,
  input: RecallInput,
  opts: HybridOptions = {},
): Promise<RecallRow[]> {
  const mode = opts.mode ?? 'hybrid';
  const limit = input.limit ?? 20;

  const ftsRows = recall(db, input);
  if (mode === 'keyword' || !opts.embedder) return ftsRows;

  let vecRanked: Array<{ row: MemoryRow; sim: number }> = [];
  try {
    const [qvec] = await opts.embedder.embed([input.query]);
    if (qvec && qvec.length > 0) {
      vecRanked = loadCandidateVectors(db, input)
        .map((c) => ({ row: c.row, sim: cosineSimilarity(qvec, c.vector) }))
        .filter((c) => c.sim > 0)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, limit * 3);
    }
  } catch (err) {
    console.warn(`[ctk] semantic recall failed: ${(err as Error).message}. Keyword results only.`);
    return ftsRows;
  }

  if (mode === 'semantic') {
    return vecRanked.slice(0, limit).map((c) => ({ ...c.row, rank: c.sim }));
  }

  // Fuse both legs.
  const fused = reciprocalRankFusion([ftsRows.map((r) => r.id), vecRanked.map((c) => c.row.id)]);

  const byId = new Map<string, MemoryRow>();
  for (const r of ftsRows) byId.set(r.id, r);
  for (const c of vecRanked) if (!byId.has(c.row.id)) byId.set(c.row.id, c.row);

  const out: RecallRow[] = [];
  for (const f of fused.slice(0, limit)) {
    const row = byId.get(f.id) ?? rowById(db, f.id);
    if (row) out.push({ ...row, rank: f.score });
  }
  return out;
}
