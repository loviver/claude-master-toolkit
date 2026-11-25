/** Where the knowledge repo lives: setting `team.repo`, else CTK_TEAM_REPO. */
import type Database from 'better-sqlite3';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { basename, join, resolve } from 'path';
import { ctkHome } from '../paths/ctk-home.js';

const REPO = 'team.repo';

export function readSetting(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function writeSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, Date.now());
}

export function getTeamRepo(db: Database.Database): string | undefined {
  return readSetting(db, REPO) ?? process.env['CTK_TEAM_REPO'];
}

const REMOTE_URL = /^(?:[a-z][a-z0-9+.-]*:\/\/|[\w.-]+@[\w.-]+:)/i;

/** Accepts a local clone, or a remote URL that is cloned under the ctk home. */
export function setTeamRepo(db: Database.Database, target: string): string {
  let path: string;
  if (REMOTE_URL.test(target)) {
    const name = basename(target.replace(/\/+$/, '')).replace(/\.git$/, '');
    path = join(ctkHome(), 'team', name);
    if (!existsSync(path)) {
      mkdirSync(join(ctkHome(), 'team'), { recursive: true });
      execFileSync('git', ['clone', '--quiet', '--', target, path], { stdio: ['ignore', 'ignore', 'pipe'] });
    }
  } else {
    path = resolve(target);
  }
  if (!existsSync(join(path, '.git'))) throw new Error(`${path} is not a git clone`);
  writeSetting(db, REPO, path);
  return path;
}
