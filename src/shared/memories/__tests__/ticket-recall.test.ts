import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrate } from '../../db/migrate.js';
import { openMemDb, save, recall, getById, exportVault, importVault } from '../v2.js';
import { loadCandidateVectors } from '../embedding/index.js';
import { recallHybrid } from '../hybrid.js';

const NEW_COLUMNS = ['ticket', 'author', 'commit_sha', 'git_branch', 'team_synced_at'];

describe('memories: ticket + provenance', () => {
  let dir: string;
  let original: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ctk-ticket-mem-'));
    original = process.env['CTK_DB_PATH'];
    process.env['CTK_DB_PATH'] = join(dir, 'ctk.sqlite');
    migrate();
  });

  afterEach(() => {
    if (original !== undefined) process.env['CTK_DB_PATH'] = original;
    else delete process.env['CTK_DB_PATH'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds the new columns to an existing vault without losing rows', () => {
    const first = openMemDb();
    const row = save(first, { title: 'old row' });
    first.close();
    const raw = new Database(process.env['CTK_DB_PATH']!);
    raw.exec('DROP INDEX IF EXISTS idx_memories_v2_ticket');
    for (const c of NEW_COLUMNS) raw.exec(`ALTER TABLE memories_v2 DROP COLUMN ${c}`);
    raw.close();

    const db = openMemDb();
    const cols = (db.prepare('PRAGMA table_info(memories_v2)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(NEW_COLUMNS));
    expect(getById(db, row.id)!.title).toBe('old row');
    db.close();
  });

  it('stores ticket and provenance, and keeps them on topic upsert', () => {
    const db = openMemDb();
    const first = save(db, {
      title: 'a', topicKey: 'k', ticket: 'DEV-1', author: 'a@example.com', commitSha: 's1', gitBranch: 'b1',
    });
    expect(first).toMatchObject({ ticket: 'DEV-1', author: 'a@example.com', commit_sha: 's1', git_branch: 'b1' });
    const second = save(db, { title: 'a2', topicKey: 'k', commitSha: 's2' });
    expect(second).toMatchObject({ id: first.id, ticket: 'DEV-1', commit_sha: 's2', git_branch: 'b1' });
    db.close();
  });

  it('keeps several memories for the same ticket', () => {
    const db = openMemDb();
    save(db, { title: 'one', ticket: 'DEV-1' });
    save(db, { title: 'two', ticket: 'DEV-1' });
    save(db, { title: 'other', ticket: 'DEV-2' });
    expect(recall(db, { query: '', ticket: 'DEV-1' }).map((r) => r.title).sort()).toEqual(['one', 'two']);
    expect(recall(db, { query: 'other', ticket: 'DEV-1' })).toEqual([]);
    expect(recall(db, { query: '' })).toEqual([]);
    db.close();
  });

  it('applies the ticket filter to both recall legs', async () => {
    const db = openMemDb();
    const mine = save(db, { title: 'alpha', ticket: 'DEV-1' });
    const other = save(db, { title: 'alpha', ticket: 'DEV-2' });
    const insert = db.prepare(
      'INSERT INTO memory_embeddings (memory_id, model, dim, vector, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const r of [mine, other]) insert.run(r.id, 'm', 1, Buffer.from(new Float32Array([1]).buffer), 1);
    expect(loadCandidateVectors(db, { ticket: 'DEV-1' }).map((c) => c.row.id)).toEqual([mine.id]);
    const embedder = { id: 'm', dim: 1, embed: async () => [new Float32Array([1])] };
    const listed = await recallHybrid(db, { query: '', ticket: 'DEV-1' }, { embedder: embedder as never });
    expect(listed.map((r) => r.id)).toEqual([mine.id]);
    db.close();
  });

  it('round-trips the new columns through export and import', () => {
    const db = openMemDb();
    const row = save(db, { title: 'a', ticket: 'DEV-1', author: 'a@example.com' });
    const dump = exportVault(db, {});
    db.prepare('DELETE FROM memories_v2').run();
    importVault(db, dump);
    expect(getById(db, row.id)).toMatchObject({ ticket: 'DEV-1', author: 'a@example.com' });
    db.close();
  });
});
