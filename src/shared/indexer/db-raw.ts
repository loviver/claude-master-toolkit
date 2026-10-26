import type Database from 'better-sqlite3';
import { openSqlite } from '../db/open.js';
import { ctkPaths } from '../paths/ctk-home.js';
import { migrate } from '../db/migrate.js';

// v2: dep/caller edges are file-qualified (`file::symbol`). Bumping wipes any
// v1 index (bare-name edges) so it rebuilds in the new collision-proof format.
const INDEXER_SCHEMA_VERSION = 2;

export function openDb(): Database.Database {
  let db = openSqlite(ctkPaths.db());

  // Only the server/install ran migrate(); a fresh or stub DB (new CTK_HOME, sandboxed
  // agent, stale legacy copy) would fail with "no such table". Cheap check, then migrate.
  const ready = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='indexed_files'").get();
  if (!ready) {
    db.close();
    migrate();
    db = openSqlite(ctkPaths.db());
  }

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
