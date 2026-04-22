import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

export interface GitStats {
  insertions: number;
  deletions: number;
  filesChanged: number;
  available: boolean;
}

const EMPTY: GitStats = { insertions: 0, deletions: 0, filesChanged: 0, available: false };
const cache = new Map<string, { at: number; data: GitStats }>();
const TTL_MS = 60_000;

export function getGitStats(sessionId: string, projectPath: string, startedAt: number, lastActiveAt: number): GitStats {
  const cached = cache.get(sessionId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  const absPath = resolve(projectPath);
  if (!existsSync(absPath)) return EMPTY;

  try {
    execSync(`git -C "${absPath}" rev-parse --git-dir`, { stdio: 'pipe', timeout: 2000 });

    const startISO = new Date(startedAt - 2 * 60_000).toISOString();
    const endISO   = new Date(lastActiveAt + 30 * 60_000).toISOString();

    let insertions = 0;
    let deletions = 0;
    const files = new Set<string>();

    function absorb(output: string) {
      for (const line of output.split('\n')) {
        const parts = line.trim().split('\t');
        if (parts.length >= 3) {
          const ins  = parseInt(parts[0], 10);
          const dels = parseInt(parts[1], 10);
          if (!isNaN(ins) && !isNaN(dels)) {
            insertions += ins;
            deletions  += dels;
            if (parts[2]) files.add(parts[2]);
          }
        }
      }
    }

    absorb(execSync(
      `git -C "${absPath}" log --numstat --format="" --after="${startISO}" --before="${endISO}"`,
      { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 },
    ));

    try {
      absorb(execSync(
        `git -C "${absPath}" diff --numstat HEAD`,
        { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 },
      ));
    } catch { /* HEAD may not exist on empty repo */ }

    const data: GitStats = { insertions, deletions, filesChanged: files.size, available: true };
    cache.set(sessionId, { at: Date.now(), data });
    return data;
  } catch {
    return EMPTY;
  }
}
