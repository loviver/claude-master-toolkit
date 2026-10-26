import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { openSqlite } from './open.js';
import { ctkPaths } from '../paths/ctk-home.js';

function resolveDbPath(): string {
  return ctkPaths.db();
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

export function getDb() {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  _sqlite = openSqlite(dbPath);

  _db = drizzle(_sqlite, { schema });

  return _db;
}

/** The raw better-sqlite3 handle behind getDb(), for shared queries that take one (indexer). */
export function getSqlite(): Database.Database {
  getDb();
  return _sqlite!;
}

export function closeDb(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}

export function getDbPath(): string {
  return resolveDbPath();
}

process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });
