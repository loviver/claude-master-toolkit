import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

export function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A repo on `branch` with one commit and a local identity. */
export function makeRepo(dir: string, branch: string): string {
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'config', 'user.email', 'dev@example.com');
  git(dir, 'config', 'user.name', 'Dev');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
