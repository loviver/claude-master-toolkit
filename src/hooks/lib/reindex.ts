import { closeSync, mkdirSync, openSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { spawn, spawnSync } from 'child_process';
import { ctkHome } from '../../shared/paths/ctk-home-paths.js';

const STALE_MS = 10 * 60_000;

function takeLock(lock: string): boolean {
  mkdirSync(join(ctkHome(), 'hooks-state'), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      closeSync(openSync(lock, 'wx'));
      return true;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_MS) rmSync(lock, { force: true });
        else return false;
      } catch {
        /* raced with the owner releasing it: retry */
      }
    }
  }
  return false;
}

/**
 * Incremental `ctk index build`. At most one run per project at a time (O_EXCL lock);
 * a concurrent edit skips and the index self-heals on the next one.
 * Detached by default (zero turn latency); CTK_REINDEX_SYNC=1 runs inline (test seam).
 */
export function reindex(cwd: string): void {
  const lock = join(ctkHome(), 'hooks-state', `reindex-${cwd.replace(/\//g, '-')}.lock`);
  if (!takeLock(lock)) return;

  if (process.env['CTK_REINDEX_SYNC'] === '1') {
    try {
      spawnSync('ctk', ['index', 'build'], { cwd, stdio: 'ignore' });
    } finally {
      rmSync(lock, { force: true });
    }
    return;
  }
  try {
    spawn('sh', ['-c', 'ctk index build >/dev/null 2>&1; rm -f "$1"', 'sh', lock], {
      cwd,
      detached: true,
      stdio: 'ignore',
    }).unref();
  } catch {
    rmSync(lock, { force: true });
  }
}
