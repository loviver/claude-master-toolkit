import type Database from 'better-sqlite3';
import type { MemoryRow, MemoryType, MemoryScope } from '../types.js';
import type { Embedder } from './port.js';
import { canonicalMemoryText } from './text.js';
import { encodeVector, decodeVector } from '../vector.js';

export type { Embedder } from './port.js';

// ── Config ──

export type EmbedderKind = 'local' | 'ollama' | 'api' | 'none';

export interface EmbedderConfig {
  kind: EmbedderKind;
  model?: string;
  endpoint?: string;
  apiKey?: string;
}

/** Multilingual (ES+EN) 384-dim model — the whole point is bridging "créditos IA"↔"ai credits". */
export const DEFAULT_LOCAL_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

function getSetting(db: Database.Database, key: string): string | undefined {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  } catch {
    return undefined;
  }
}

export function readEmbedderConfig(db: Database.Database): EmbedderConfig {
  const kind = (getSetting(db, 'pandorica.embedder') ?? process.env['CTK_EMBEDDER'] ?? 'local') as EmbedderKind;
  const model = getSetting(db, 'pandorica.embedModel') ?? process.env['CTK_EMBED_MODEL'];
  const endpoint = getSetting(db, 'pandorica.embedEndpoint') ?? process.env['CTK_EMBED_ENDPOINT'];
  const apiKey = process.env['CTK_EMBED_API_KEY'] ?? process.env['OPENAI_API_KEY'];
  return { kind, model, endpoint, apiKey };
}

/** Resolve a live embedder from config. Returns null for 'none' or any init failure (never throws). */
export async function resolveEmbedder(cfg: EmbedderConfig): Promise<Embedder | null> {
  try {
    switch (cfg.kind) {
      case 'none':
        return null;
      case 'local': {
        const { createLocalEmbedder } = await import('./local.js');
        return await createLocalEmbedder(cfg.model ?? DEFAULT_LOCAL_MODEL);
      }
      case 'ollama': {
        const { createOllamaEmbedder } = await import('./ollama.js');
        return createOllamaEmbedder(cfg.endpoint, cfg.model);
      }
      case 'api': {
        const { createApiEmbedder } = await import('./api.js');
        return createApiEmbedder(cfg);
      }
      default:
        return null;
    }
  } catch (err) {
    console.warn(
      `[ctk] embedder '${cfg.kind}' unavailable: ${(err as Error).message}. Recall stays keyword-only.`,
    );
    return null;
  }
}

/** Convenience: read config from the DB and resolve. */
export function resolveEmbedderFromDb(db: Database.Database): Promise<Embedder | null> {
  return resolveEmbedder(readEmbedderConfig(db));
}

// ── Persistence ──

/** Compute + upsert the dense vector for one memory. No-op if the memory has no embeddable text. */
export async function embedMemory(db: Database.Database, row: MemoryRow, embedder: Embedder): Promise<void> {
  const text = canonicalMemoryText(row);
  if (!text) return;
  const [vec] = await embedder.embed([text]);
  if (!vec || vec.length === 0) return;
  db.prepare(
    `INSERT INTO memory_embeddings (memory_id, model, dim, vector, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(memory_id) DO UPDATE SET
       model = excluded.model, dim = excluded.dim,
       vector = excluded.vector, created_at = excluded.created_at`,
  ).run(row.id, embedder.id, vec.length, encodeVector(vec), Date.now());
}

export function countEmbeddings(db: Database.Database): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM memory_embeddings').get() as { n: number };
  return r.n;
}

// ── Process-cached embedder (avoids reloading the model per save) ──

let _cached: { key: string; embedder: Embedder | null } | null = null;

export async function getCachedEmbedder(db: Database.Database): Promise<Embedder | null> {
  const cfg = readEmbedderConfig(db);
  const key = `${cfg.kind}:${cfg.model ?? ''}:${cfg.endpoint ?? ''}`;
  if (_cached && _cached.key === key) return _cached.embedder;
  const embedder = await resolveEmbedder(cfg);
  _cached = { key, embedder };
  return embedder;
}

/** Embed a just-saved memory if an embedder is configured. Never throws, never blocks correctness. */
export async function embedMemoryBestEffort(db: Database.Database, row: MemoryRow): Promise<void> {
  try {
    const embedder = await getCachedEmbedder(db);
    if (embedder) await embedMemory(db, row, embedder);
  } catch {
    /* non-fatal: reindex recovers it */
  }
}

/** Backfill: (re)embed every memory in the vault. Returns counts; calls onProgress after each. */
export async function reindexAll(
  db: Database.Database,
  embedder: Embedder,
  onProgress?: (done: number, total: number) => void,
): Promise<{ total: number; embedded: number }> {
  const rows = db.prepare('SELECT * FROM memories_v2').all() as MemoryRow[];
  let embedded = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      await embedMemory(db, rows[i]!, embedder);
      embedded++;
    } catch {
      /* skip unembeddable row */
    }
    onProgress?.(i + 1, rows.length);
  }
  return { total: rows.length, embedded };
}

// ── Candidate loading for the vector leg ──

export interface CandidateFilter {
  type?: MemoryType;
  scope?: MemoryScope;
  projectPath?: string;
  sessionId?: string;
}

export interface Candidate {
  row: MemoryRow;
  vector: Float32Array;
}

/** All embedded memories matching the filter, joined to their vectors (brute-force candidate set). */
export function loadCandidateVectors(db: Database.Database, filter: CandidateFilter): Candidate[] {
  const parts: string[] = [];
  const args: unknown[] = [];
  if (filter.type) { parts.push('m.type = ?'); args.push(filter.type); }
  if (filter.scope) { parts.push('m.scope = ?'); args.push(filter.scope); }
  if (filter.projectPath) { parts.push('m.project_path = ?'); args.push(filter.projectPath); }
  if (filter.sessionId) { parts.push('m.session_id = ?'); args.push(filter.sessionId); }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT m.*, e.vector AS _vec
       FROM memory_embeddings e
       JOIN memories_v2 m ON m.id = e.memory_id
       ${where}`,
    )
    .all(...args) as Array<MemoryRow & { _vec: Buffer }>;

  return rows.map((r) => {
    const { _vec, ...row } = r;
    return { row: row as MemoryRow, vector: decodeVector(_vec) };
  });
}
