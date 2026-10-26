import { spawnSync } from 'child_process';

export function ctkOut(args: string[], cwd?: string, timeout = 1500): string | undefined {
  try {
    const r = spawnSync('ctk', args, { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] });
    if (r.error || r.status !== 0) return undefined;
    return r.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function ctkAvailable(): boolean {
  try {
    return !spawnSync('ctk', ['--version'], { stdio: 'ignore', timeout: 1500 }).error;
  } catch {
    return false;
  }
}

export function gitDirty(cwd: string): boolean {
  try {
    const r = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', timeout: 2000 });
    return r.status === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}
