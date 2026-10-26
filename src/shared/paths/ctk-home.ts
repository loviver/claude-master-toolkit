import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  cpSync,
  rmSync,
  symlinkSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';

import { ctkHome, ctkPaths } from './ctk-home-paths.js';

export { ctkHome, ctkPaths };

function legacyStateDir(): string {
  return join(homedir(), '.claude', 'state', 'claude-master-toolkit');
}
function legacyBriefsDir(): string {
  return join(homedir(), '.claude', 'ctk', 'briefs');
}

export type MigrationStatus =
  | 'nothing-to-migrate'
  | 'already-migrated'
  | 'migrated'
  | 'would-migrate'
  | 'conflict'
  | 'skipped-in-use'
  | 'skipped-custom-db-path';

export interface MigrationReport {
  status: MigrationStatus;
  moved: string[];
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** True if another process holds the DB: a TRUNCATE checkpoint cannot complete. */
function dbInUse(dbFile: string): boolean {
  let db: Database.Database | null = null;
  try {
    db = new Database(dbFile);
    db.pragma('busy_timeout = 0');
    const r = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
    return r[0]?.busy === 1;
  } catch {
    return true;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

function moveEntry(src: string, dest: string): void {
  try {
    renameSync(src, dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    cpSync(src, dest, { recursive: true });
    rmSync(src, { recursive: true, force: true });
  }
}

/**
 * Moves ctk state from ~/.claude/state/claude-master-toolkit (+ ~/.claude/ctk/briefs)
 * to ctkHome(), leaving a compat symlink at the old state dir. Idempotent, never
 * overwrites an existing ~/.ctk database, and refuses while the DB is in use.
 */
export function migrateLegacyState(opts: { dryRun?: boolean } = {}): MigrationReport {
  if (process.env['CTK_DB_PATH']) return { status: 'skipped-custom-db-path', moved: [] };

  const legacy = legacyStateDir();
  const legacyBriefs = legacyBriefsDir();
  const target = ctkHome();

  if (isSymlink(legacy)) return { status: 'already-migrated', moved: [] };

  const hasLegacyState = existsSync(legacy);
  const hasLegacyBriefs = existsSync(legacyBriefs);
  if (!hasLegacyState && !hasLegacyBriefs) return { status: 'nothing-to-migrate', moved: [] };

  const legacyDb = join(legacy, 'ctk.sqlite');
  if (existsSync(legacyDb) && existsSync(join(target, 'ctk.sqlite'))) {
    return { status: 'conflict', moved: [] };
  }

  if (opts.dryRun) return { status: 'would-migrate', moved: [] };

  if (existsSync(legacyDb) && dbInUse(legacyDb)) {
    return { status: 'skipped-in-use', moved: [] };
  }

  mkdirSync(target, { recursive: true });
  const moved: string[] = [];

  if (hasLegacyState) {
    for (const name of readdirSync(legacy)) {
      const dest = join(target, name);
      if (existsSync(dest)) continue;
      moveEntry(join(legacy, name), dest);
      moved.push(name);
    }
    rmSync(legacy, { recursive: true, force: true });
    symlinkSync(target, legacy, 'dir');
  }

  if (hasLegacyBriefs) {
    const dest = ctkPaths.briefsDir();
    if (!existsSync(dest)) {
      moveEntry(legacyBriefs, dest);
      moved.push('briefs');
    }
  }

  return { status: 'migrated', moved };
}

let migrationChecked = false;

/**
 * Entry-point guard (cli/server/mcp): runs the legacy-state migration at most once per
 * process and never throws — a migration problem must not stop the tool from starting.
 */
export function ensureMigrated(): MigrationReport | null {
  if (migrationChecked) return null;
  migrationChecked = true;
  try {
    const r = migrateLegacyState();
    if (r.status === 'migrated') {
      process.stderr.write(`[ctk] state migrated to ${ctkHome()} (${r.moved.join(', ')})\n`);
    } else if (r.status === 'skipped-in-use' || r.status === 'conflict') {
      process.stderr.write(`[ctk] legacy state not migrated (${r.status}); will retry next run\n`);
    }
    return r;
  } catch (e) {
    process.stderr.write(`[ctk] state migration failed: ${(e as Error).message}\n`);
    return null;
  }
}
