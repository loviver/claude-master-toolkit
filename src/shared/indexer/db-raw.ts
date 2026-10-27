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
// v6: member call edges carry their owner (`file::Svc.doThing`, matching how methods are
// indexed — v5 edges to methods resolved to no node) + symbols.heritage (extends/implements).
export const INDEXER_SCHEMA_VERSION = 6;

// migrate() only runs on a fresh DB, so an existing DB from an older ctk needs its index columns added here.
const INDEX_COLUMNS: ReadonlyArray<[table: string, col: string]> = [
  ['symbols', 'refs'],
  ['symbols', 'referrers'],
  ['symbols', 'dep_sites'],
  ['symbols', 'heritage'],
  ['indexed_files', 'imports'],
];

function ensureIndexColumns(db: Database.Database): void {
  for (const [table, col] of INDEX_COLUMNS) {
    const have = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
    if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`);
  }
}

let warned = false;

function warnStale(dbVersion: number): void {
  if (warned) return;
  warned = true;
  process.stderr.write(
    `ctk: index schema v${dbVersion} is newer than this process (v${INDEXER_SCHEMA_VERSION}); ` +
      'reading only — restart it (e.g. reconnect the ctk MCP server) to pick up the current build.\n',
  );
}

/** Throws when the index was built by a newer ctk: writing from this build would mix stale-format rows into it. */
export function assertIndexWritable(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > INDEXER_SCHEMA_VERSION) {
    throw new Error(
      `index schema v${current} was built by a newer ctk than this one (v${INDEXER_SCHEMA_VERSION}); ` +
        'refusing to write. Use the current ctk build.',
    );
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

  // Several ctk builds share this DB (long-lived MCP servers outlive a rebuild). Only an
  // older index is rebuilt: a stale process wiping a newer one makes builds erase each other.
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > INDEXER_SCHEMA_VERSION) {
    warnStale(current);
  } else if (current < INDEXER_SCHEMA_VERSION) {
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
