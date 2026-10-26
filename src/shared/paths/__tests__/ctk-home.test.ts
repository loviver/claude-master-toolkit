import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  readlinkSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { ctkHome, ctkPaths, migrateLegacyState } from '../ctk-home.js';

let home: string;
const ENV_KEYS = ['HOME', 'CTK_HOME', 'CTK_DB_PATH', 'CTK_MODEL_CACHE'] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

function legacyDir() {
  return join(home, '.claude', 'state', 'claude-master-toolkit');
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ctk-home-'));
  process.env['HOME'] = home;
  delete process.env['CTK_HOME'];
  delete process.env['CTK_DB_PATH'];
  delete process.env['CTK_MODEL_CACHE'];
});

afterEach(() => {
  // Restore per key: replacing process.env detaches it from the real environ (os.homedir() would go stale).
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(home, { recursive: true, force: true });
});

describe('ctkHome / ctkPaths', () => {
  it('defaults to ~/.ctk', () => {
    expect(ctkHome()).toBe(join(home, '.ctk'));
  });

  it('CTK_HOME overrides the default', () => {
    process.env['CTK_HOME'] = '/somewhere/else';
    expect(ctkHome()).toBe('/somewhere/else');
    expect(ctkPaths.db()).toBe('/somewhere/else/ctk.sqlite');
  });

  it('CTK_DB_PATH still wins for the database', () => {
    process.env['CTK_DB_PATH'] = '/tmp/custom.sqlite';
    expect(ctkPaths.db()).toBe('/tmp/custom.sqlite');
  });

  it('CTK_MODEL_CACHE still wins for the models cache', () => {
    process.env['CTK_MODEL_CACHE'] = '/tmp/models-x';
    expect(ctkPaths.modelsCache()).toBe('/tmp/models-x');
  });

  it('derives every path from ctkHome', () => {
    const h = join(home, '.ctk');
    expect(ctkPaths.db()).toBe(join(h, 'ctk.sqlite'));
    expect(ctkPaths.modelPref()).toBe(join(h, 'model-preference'));
    expect(ctkPaths.modelsCache()).toBe(join(h, 'models'));
    expect(ctkPaths.briefsDir()).toBe(join(h, 'briefs'));
    expect(ctkPaths.logs()).toBe(join(h, 'logs'));
  });

  it('keys hook state by agent AND session so agents cannot collide', () => {
    const a = ctkPaths.hookState('claude-code', 'abc');
    const b = ctkPaths.hookState('codex', 'abc');
    expect(a).not.toBe(b);
    expect(a.startsWith(join(home, '.ctk'))).toBe(true);
  });
});

describe('migrateLegacyState', () => {
  function seedLegacy() {
    mkdirSync(legacyDir(), { recursive: true });
    const db = new Database(join(legacyDir(), 'ctk.sqlite'));
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE t (v TEXT); INSERT INTO t VALUES (\'kept\');');
    db.close();
    writeFileSync(join(legacyDir(), 'model-preference'), 'auto');
    mkdirSync(join(legacyDir(), 'models'), { recursive: true });
    writeFileSync(join(legacyDir(), 'models', 'm.bin'), 'weights');
    mkdirSync(join(home, '.claude', 'ctk', 'briefs'), { recursive: true });
    writeFileSync(join(home, '.claude', 'ctk', 'briefs', 'b1.json'), '{}');
  }

  it('is a no-op when there is no legacy state', () => {
    const r = migrateLegacyState();
    expect(r.status).toBe('nothing-to-migrate');
    expect(existsSync(join(home, '.ctk', 'ctk.sqlite'))).toBe(false);
  });

  it('moves db, preference, models cache and briefs to ~/.ctk', () => {
    seedLegacy();
    const r = migrateLegacyState();
    expect(r.status).toBe('migrated');

    const moved = new Database(join(home, '.ctk', 'ctk.sqlite'), { readonly: true });
    expect(moved.prepare('SELECT v FROM t').get()).toEqual({ v: 'kept' });
    moved.close();
    expect(readFileSync(join(home, '.ctk', 'model-preference'), 'utf8')).toBe('auto');
    expect(readFileSync(join(home, '.ctk', 'models', 'm.bin'), 'utf8')).toBe('weights');
    expect(readFileSync(join(home, '.ctk', 'briefs', 'b1.json'), 'utf8')).toBe('{}');
  });

  it('leaves a compat symlink at the legacy state dir', () => {
    seedLegacy();
    migrateLegacyState();
    expect(lstatSync(legacyDir()).isSymbolicLink()).toBe(true);
    expect(readlinkSync(legacyDir())).toBe(join(home, '.ctk'));
  });

  it('is idempotent', () => {
    seedLegacy();
    migrateLegacyState();
    const second = migrateLegacyState();
    expect(second.status).toBe('already-migrated');
    const db = new Database(join(home, '.ctk', 'ctk.sqlite'), { readonly: true });
    expect(db.prepare('SELECT v FROM t').get()).toEqual({ v: 'kept' });
    db.close();
  });

  it('does not overwrite an existing ~/.ctk database (conflict)', () => {
    seedLegacy();
    mkdirSync(join(home, '.ctk'), { recursive: true });
    writeFileSync(join(home, '.ctk', 'ctk.sqlite'), 'NEW');
    const r = migrateLegacyState();
    expect(r.status).toBe('conflict');
    expect(readFileSync(join(home, '.ctk', 'ctk.sqlite'), 'utf8')).toBe('NEW');
    // legacy untouched
    expect(lstatSync(legacyDir()).isSymbolicLink()).toBe(false);
    expect(existsSync(join(legacyDir(), 'ctk.sqlite'))).toBe(true);
  });

  it('skips when another process holds the legacy database open for writing', () => {
    seedLegacy();
    const holder = new Database(join(legacyDir(), 'ctk.sqlite'));
    holder.pragma('journal_mode = WAL');
    holder.exec('BEGIN IMMEDIATE');
    try {
      const r = migrateLegacyState();
      expect(r.status).toBe('skipped-in-use');
      expect(existsSync(join(home, '.ctk', 'ctk.sqlite'))).toBe(false);
      expect(existsSync(join(legacyDir(), 'ctk.sqlite'))).toBe(true);
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
    }
  });

  it('dryRun reports without touching the filesystem', () => {
    seedLegacy();
    const r = migrateLegacyState({ dryRun: true });
    expect(r.status).toBe('would-migrate');
    expect(existsSync(join(home, '.ctk'))).toBe(false);
    expect(lstatSync(legacyDir()).isSymbolicLink()).toBe(false);
  });

  it('honours CTK_DB_PATH by not migrating at all', () => {
    seedLegacy();
    process.env['CTK_DB_PATH'] = join(home, 'elsewhere.sqlite');
    const r = migrateLegacyState();
    expect(r.status).toBe('skipped-custom-db-path');
    expect(existsSync(join(legacyDir(), 'ctk.sqlite'))).toBe(true);
  });
});
