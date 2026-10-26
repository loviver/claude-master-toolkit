import type Database from 'better-sqlite3';
import { openSqlite } from '../db/open.js';
import { ctkPaths } from '../paths/ctk-home.js';
import { migrate } from '../db/migrate.js';

// v2: dep/caller edges are file-qualified (`file::symbol`). Bumping wipes any
// v1 index (bare-name edges) so it rebuilds in the new collision-proof format.
// v3: adds symbols.refs/referrers + indexed_files.imports, JSX/`new` call edges and
// arrow-fn signatures — a v2 index lacks all of it, so it must rebuild.
// v4: adds symbols.dep_sites (call-site lines per dep) — older rows lack it, so rebuild.
// v5: typed non-function consts get a signature (`useX: Hook<T>`) — v4 rows hold null.
const INDEXER_SCHEMA_VERSION = 5;

// migrate() only runs on a fresh DB, so an existing DB from an older ctk needs its index columns added here.
const INDEX_COLUMNS: ReadonlyArray<[table: string, col: string]> = [
  ['symbols', 'refs'],
  ['symbols', 'referrers'],
  ['symbols', 'dep_sites'],
  ['indexed_files', 'imports'],
];

function ensureIndexColumns(db: Database.Database): void {
  for (const [table, col] of INDEX_COLUMNS) {
    const have = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
    if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`);
  }
}

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
    ensureIndexColumns(db);
    try {
      db.exec('DELETE FROM symbols; DELETE FROM indexed_files;');
    } catch {
      // tables may not exist yet on first run; migrate() creates them
    }
    db.pragma(`user_version = ${INDEXER_SCHEMA_VERSION}`);
  }
  return db;
}
