import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const INDEXER_SCHEMA_VERSION = 1;

export function openDb(): Database.Database {
  const path = process.env['CTK_DB_PATH']
    ?? join(homedir(), '.claude', 'state', 'claude-master-toolkit', 'ctk.sqlite');
  mkdirSync(join(path, '..'), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  const current = db.pragma('user_version', { simple: true }) as number;
  if (current !== INDEXER_SCHEMA_VERSION) {
    try {
      db.exec('DELETE FROM symbols; DELETE FROM indexed_files;');
    } catch {
      // tables may not exist yet on first run; migrate() creates them
    }
    db.pragma(`user_version = ${INDEXER_SCHEMA_VERSION}`);
  }
  return db;
}
