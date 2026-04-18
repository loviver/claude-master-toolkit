import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import * as schema from './schema.js';

const DEFAULT_DB_DIR = join(homedir(), '.claude', 'state', 'claude-master-toolkit');
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, 'ctk.sqlite');

function resolveDbPath(): string {
  return process.env['CTK_DB_PATH'] ?? DEFAULT_DB_PATH;
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb() {
  if (_db) return _db;

  const dbPath = resolveDbPath();
  mkdirSync(join(dbPath, '..'), { recursive: true });

  _sqlite = new Database(dbPath);
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('foreign_keys = ON');

  _db = drizzle(_sqlite, { schema });

  return _db;
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
