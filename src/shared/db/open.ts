import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export const BUSY_TIMEOUT_MS = 5000;

/**
 * Single place that opens ctk's SQLite DB. Claude Code and Codex hooks can write
 * concurrently, so every opener MUST go through here to get the same pragmas.
 */
export function openSqlite(path: string, opts: { readonly?: boolean } = {}): Database.Database {
  if (!opts.readonly) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, opts.readonly ? { readonly: true } : undefined);
  // busy_timeout first: the pragmas below can themselves need a lock.
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  if (!opts.readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');
  return db;
}
