import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrate } from '../../../server/db/migrate.js';
import {
  openMemDb, save, update, deleteById, mark, recall, context, trace, getById,
  sessionStart, sessionEnd, sessionSummary, passive, merge, suggest, stats,
  exportVault, importVault,
} from '../v2.js';

describe('memories/v2', () => {
  let tmpDir: string;
  let dbPath: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctk-mem-v2-'));
    dbPath = join(tmpDir, 'ctk.sqlite');
    originalEnv = process.env['CTK_DB_PATH'];
    process.env['CTK_DB_PATH'] = dbPath;
    migrate();
  });

  afterEach(() => {
    if (originalEnv !== undefined) process.env['CTK_DB_PATH'] = originalEnv;
    else delete process.env['CTK_DB_PATH'];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('inserts a new memory and returns the row', () => {
      const db = openMemDb();
      try {
        const row = save(db, { title: 'hello', type: 'note', what: 'world' });
        expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(row.title).toBe('hello');
        expect(row.what).toBe('world');
        expect(row.type).toBe('note');
        expect(row.scope).toBe('project');
        expect(row.access_count).toBe(0);
        expect(row.created_at).toBe(row.updated_at);
      } finally { db.close(); }
    });

    it('upserts by topic_key preserving id', () => {
      const db = openMemDb();
      try {
        const first = save(db, { title: 't1', type: 'note', what: 'w1', topicKey: 'k/1' });
        const second = save(db, { title: 't2', type: 'note', what: 'w2', topicKey: 'k/1' });
        expect(second.id).toBe(first.id);
        expect(second.title).toBe('t2');
        expect(second.what).toBe('w2');
        expect(second.updated_at).toBeGreaterThanOrEqual(first.created_at);
      } finally { db.close(); }
    });

    it('stores cost enrichment fields', () => {
      const db = openMemDb();
      try {
        const row = save(db, {
          title: 'x', type: 'decision', what: 'y',
          model: 'claude-opus-4-7', phase: 'sdd-propose',
          tokensInput: 1000, tokensOutput: 200, cacheHitPct: 0.7, costUsd: 0.015,
        });
        expect(row.model).toBe('claude-opus-4-7');
        expect(row.phase).toBe('sdd-propose');
        expect(row.tokens_input).toBe(1000);
        expect(row.cost_usd).toBeCloseTo(0.015);
      } finally { db.close(); }
    });
  });

  describe('update', () => {
    it('modifies fields and bumps updated_at', async () => {
      const db = openMemDb();
      try {
        const row = save(db, { title: 't', type: 'note', what: 'a' });
        await new Promise((r) => setTimeout(r, 5));
        const next = update(db, row.id, { what: 'b', why: 'because' });
        expect(next).not.toBeNull();
        expect(next!.what).toBe('b');
        expect(next!.why).toBe('because');
        expect(next!.updated_at).toBeGreaterThan(row.created_at);
        expect(next!.created_at).toBe(row.created_at);
      } finally { db.close(); }
    });

    it('returns null for missing id', () => {
      const db = openMemDb();
      try {
        expect(update(db, 'nope', { what: 'x' })).toBeNull();
      } finally { db.close(); }
    });
  });

  describe('deleteById', () => {
    it('removes row and returns true', () => {
      const db = openMemDb();
      try {
        const row = save(db, { title: 't', type: 'note', what: 'x' });
        expect(deleteById(db, row.id)).toBe(true);
        expect(getById(db, row.id)).toBeNull();
      } finally { db.close(); }
    });

    it('returns false when id missing', () => {
      const db = openMemDb();
      try {
        expect(deleteById(db, 'nope')).toBe(false);
      } finally { db.close(); }
    });
  });

  describe('mark', () => {
    it('assigns topic_key to an existing memory', () => {
      const db = openMemDb();
      try {
        const row = save(db, { title: 't', type: 'note', what: 'x' });
        const marked = mark(db, row.id, 'topic/alpha');
        expect(marked).not.toBeNull();
        expect(marked!.topic_key).toBe('topic/alpha');
      } finally { db.close(); }
    });
  });

  describe('recall (FTS5 + BM25)', () => {
    it('ranks higher-frequency matches first', () => {
      const db = openMemDb();
      try {
        save(db, { title: 'a1', type: 'note', what: 'alpha' });
        save(db, { title: 'a2', type: 'note', what: 'alpha alpha alpha' });
        save(db, { title: 'a3', type: 'note', what: 'alpha alpha alpha alpha alpha' });

        const results = recall(db, { query: 'alpha' });
        expect(results.length).toBe(3);
        expect(results[0]!.title).toBe('a3');
        expect(results[1]!.title).toBe('a2');
        expect(results[2]!.title).toBe('a1');
      } finally { db.close(); }
    });

    it('logs a memory_searches row on every query (hit or miss)', () => {
      const db = openMemDb();
      try {
        save(db, { title: 't', type: 'note', what: 'alpha' });
        recall(db, { query: 'alpha' });
        recall(db, { query: 'nosuchterm' });

        const rows = db.prepare(`SELECT query FROM memory_searches ORDER BY created_at`).all() as Array<{ query: string }>;
        expect(rows.length).toBe(2);
        expect(rows[0]!.query).toBe('alpha');
        expect(rows[1]!.query).toBe('nosuchterm');
      } finally { db.close(); }
    });

    it('filters by type', () => {
      const db = openMemDb();
      try {
        save(db, { title: 'note1', type: 'note', what: 'beta' });
        save(db, { title: 'dec1', type: 'decision', what: 'beta' });
        const r = recall(db, { query: 'beta', type: 'decision' });
        expect(r.length).toBe(1);
        expect(r[0]!.type).toBe('decision');
      } finally { db.close(); }
    });
  });

  describe('context', () => {
    it('returns recent project-scoped memories', () => {
      const db = openMemDb();
      try {
        save(db, { title: 'a', type: 'note', what: 'x', projectPath: '/p1' });
        save(db, { title: 'b', type: 'note', what: 'y', projectPath: '/p2' });
        const rows = context(db, { projectPath: '/p1' });
        expect(rows.length).toBe(1);
        expect(rows[0]!.title).toBe('a');
      } finally { db.close(); }
    });
  });

  describe('trace', () => {
    it('returns memories ordered by created_at desc', async () => {
      const db = openMemDb();
      try {
        save(db, { title: 'first', type: 'note', what: 'x' });
        await new Promise((r) => setTimeout(r, 5));
        save(db, { title: 'second', type: 'note', what: 'y' });
        const rows = trace(db, { limit: 10 });
        expect(rows[0]!.title).toBe('second');
        expect(rows[1]!.title).toBe('first');
      } finally { db.close(); }
    });
  });

  describe('getById', () => {
    it('increments access_count and sets accessed_at', () => {
      const db = openMemDb();
      try {
        const row = save(db, { title: 't', type: 'note', what: 'x' });
        const first = getById(db, row.id);
        const second = getById(db, row.id);
        expect(first!.access_count).toBe(1);
        expect(second!.access_count).toBe(2);
        expect(second!.accessed_at).not.toBeNull();
      } finally { db.close(); }
    });

    it('returns null for unknown id', () => {
      const db = openMemDb();
      try {
        expect(getById(db, 'nope')).toBeNull();
      } finally { db.close(); }
    });
  });

  describe('sessionStart / sessionEnd / sessionSummary', () => {
    it('sessionSummary writes type=session_summary with topic_key session/{sid}', () => {
      const db = openMemDb();
      try {
        const row = sessionSummary(db, { sessionId: 's1', content: 'done', projectPath: '/p' });
        expect(row.type).toBe('session_summary');
        expect(row.topic_key).toBe('session/s1');
        expect(row.what).toBe('done');
      } finally { db.close(); }
    });

    it('sessionStart tags memory with session id', () => {
      const db = openMemDb();
      try {
        const row = sessionStart(db, { sessionId: 's2', projectPath: '/p' });
        expect(row.session_id).toBe('s2');
        expect(row.topic_key).toBe('session/start/s2');
      } finally { db.close(); }
    });

    it('sessionEnd tags memory with session id', () => {
      const db = openMemDb();
      try {
        const row = sessionEnd(db, { sessionId: 's3', summary: 'bye' });
        expect(row.session_id).toBe('s3');
        expect(row.topic_key).toBe('session/end/s3');
        expect(row.what).toBe('bye');
      } finally { db.close(); }
    });
  });

  describe('passive', () => {
    it('saves a passive note memory', () => {
      const db = openMemDb();
      try {
        const row = passive(db, { content: 'observed', sessionId: 's1', source: 'hook' });
        expect(row.type).toBe('note');
        expect(row.what).toBe('observed');
        expect(row.description).toBe('hook');
      } finally { db.close(); }
    });
  });

  describe('merge', () => {
    it('moves memories from one project_path to another', () => {
      const db = openMemDb();
      try {
        save(db, { title: 'a', type: 'note', what: 'x', projectPath: '/old' });
        save(db, { title: 'b', type: 'note', what: 'y', projectPath: '/old' });
        save(db, { title: 'c', type: 'note', what: 'z', projectPath: '/other' });
        const result = merge(db, { from: '/old', to: '/new' });
        expect(result.moved).toBe(2);
        expect(context(db, { projectPath: '/new' }).length).toBe(2);
        expect(context(db, { projectPath: '/old' }).length).toBe(0);
      } finally { db.close(); }
    });
  });

  describe('suggest', () => {
    it('returns existing topic_keys ranked by overlap', () => {
      const db = openMemDb();
      try {
        save(db, { title: 'auth model', type: 'architecture', what: 'session tokens', topicKey: 'architecture/auth-model' });
        save(db, { title: 'db schema', type: 'architecture', what: 'sqlite schema', topicKey: 'architecture/db-schema' });
        const hints = suggest(db, { title: 'auth session', limit: 3 });
        expect(hints.length).toBeGreaterThan(0);
        expect(hints[0]!.topicKey).toBe('architecture/auth-model');
      } finally { db.close(); }
    });
  });

  describe('stats', () => {
    it('returns counts by type and total memories', () => {
      const db = openMemDb();
      try {
        save(db, { title: 'a', type: 'note', what: 'x' });
        save(db, { title: 'b', type: 'decision', what: 'y' });
        save(db, { title: 'c', type: 'decision', what: 'z' });
        const s = stats(db, {});
        expect(s.memoriesTotal).toBe(3);
        expect(s.memoriesByType['decision']).toBe(2);
        expect(s.memoriesByType['note']).toBe(1);
      } finally { db.close(); }
    });
  });

  describe('exportVault / importVault round-trip', () => {
    it('dumps and re-imports memories idempotently', () => {
      const db = openMemDb();
      try {
        const a = save(db, { title: 'a', type: 'note', what: 'x' });
        save(db, { title: 'b', type: 'decision', what: 'y' });
        const dump = exportVault(db, {});
        expect(dump.memories.length).toBe(2);

        deleteById(db, a.id);
        const restored = importVault(db, dump);
        expect(restored.imported).toBeGreaterThanOrEqual(1);
        expect(getById(db, a.id)).not.toBeNull();

        const again = importVault(db, dump);
        expect(again.imported).toBe(0);
        expect(again.skipped).toBe(2);
      } finally { db.close(); }
    });
  });
});
