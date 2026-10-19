import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrate } from '../../db/migrate.js';
import { openMemDb, save, deleteById } from '../v2.js';
import { recall } from '../search.js';
import { recallHybrid } from '../hybrid.js';
import { embedMemory, countEmbeddings } from '../embedding/index.js';
import type { Embedder } from '../embedding/port.js';

/**
 * Deterministic keyword→axis embedder. Bridges ES/EN synonyms onto shared axes so tests
 * can assert cross-language semantic recall WITHOUT downloading a real model.
 */
const AXES: Record<string, string[]> = {
  credits: ['credits', 'credit', 'creditos', 'créditos', 'wallet', 'ai', 'ia'],
  bake: ['bake', 'snapshot', 'workflow'],
  infra: ['infra', 'pool', 'edge'],
};
const AXIS_KEYS = Object.keys(AXES);

const fakeEmbedder: Embedder = {
  id: 'fake:test',
  dim: AXIS_KEYS.length,
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const lower = t.toLowerCase();
      const v = new Float32Array(AXIS_KEYS.length);
      AXIS_KEYS.forEach((axis, i) => {
        if (AXES[axis]!.some((syn) => lower.includes(syn))) v[i] = 1;
      });
      return v;
    });
  },
};

describe('recallHybrid', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctk-hybrid-'));
    originalEnv = process.env['CTK_DB_PATH'];
    process.env['CTK_DB_PATH'] = join(tmpDir, 'ctk.sqlite');
    migrate();
  });

  afterEach(() => {
    if (originalEnv !== undefined) process.env['CTK_DB_PATH'] = originalEnv;
    else delete process.env['CTK_DB_PATH'];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('embedMemory persists one vector row per memory', async () => {
    const db = openMemDb();
    try {
      const m = save(db, { title: 'Créditos IA', type: 'architecture', what: 'wallet via grant port' });
      await embedMemory(db, m, fakeEmbedder);
      expect(countEmbeddings(db)).toBe(1);
      const row = db.prepare('SELECT model, dim FROM memory_embeddings WHERE memory_id = ?').get(m.id) as { model: string; dim: number };
      expect(row.model).toBe('fake:test');
      expect(row.dim).toBe(3);
    } finally { db.close(); }
  });

  it('bridges ES↔EN: keyword FTS misses but hybrid finds it via the vector leg', async () => {
    const db = openMemDb();
    try {
      const m1 = save(db, { title: 'Créditos IA', type: 'architecture', what: 'wallet recargable vía grant port' });
      const m2 = save(db, { title: 'Bake pipeline', type: 'architecture', what: 'snapshot workflow' });
      await embedMemory(db, m1, fakeEmbedder);
      await embedMemory(db, m2, fakeEmbedder);

      // keyword leg alone: EN query vs ES content → zero (this is the bug we hit live)
      expect(recall(db, { query: 'ai credits pricing' }).length).toBe(0);

      // hybrid: vector leg rescues it
      const hits = await recallHybrid(db, { query: 'ai credits pricing' }, { embedder: fakeEmbedder });
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0]!.title).toBe('Créditos IA');
      expect(hits.some((h) => h.id === m2.id)).toBe(false);
    } finally { db.close(); }
  });

  it('mode=keyword ignores the vector leg (pure FTS)', async () => {
    const db = openMemDb();
    try {
      const m1 = save(db, { title: 'Créditos IA', type: 'architecture', what: 'wallet' });
      await embedMemory(db, m1, fakeEmbedder);
      const hits = await recallHybrid(db, { query: 'ai credits' }, { embedder: fakeEmbedder, mode: 'keyword' });
      expect(hits.length).toBe(0);
    } finally { db.close(); }
  });

  it('falls back to FTS-only when no embedder is available', async () => {
    const db = openMemDb();
    try {
      save(db, { title: 'alpha note', type: 'note', what: 'alpha content' });
      const hits = await recallHybrid(db, { query: 'alpha' }, { embedder: null });
      expect(hits.length).toBe(1);
      expect(hits[0]!.title).toBe('alpha note');
    } finally { db.close(); }
  });

  it('never throws when the embedder errors — degrades to FTS', async () => {
    const db = openMemDb();
    try {
      save(db, { title: 'alpha note', type: 'note', what: 'alpha content' });
      const boom: Embedder = { id: 'boom', dim: 3, async embed() { throw new Error('model down'); } };
      const hits = await recallHybrid(db, { query: 'alpha' }, { embedder: boom });
      expect(hits.length).toBe(1);
      expect(hits[0]!.title).toBe('alpha note');
    } finally { db.close(); }
  });

  it('cascade-deletes the vector when the memory is deleted', async () => {
    const db = openMemDb();
    try {
      const m = save(db, { title: 'x', type: 'note', what: 'y' });
      await embedMemory(db, m, fakeEmbedder);
      expect(countEmbeddings(db)).toBe(1);
      deleteById(db, m.id);
      expect(countEmbeddings(db)).toBe(0);
    } finally { db.close(); }
  });
});
