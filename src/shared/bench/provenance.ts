import { execSync } from 'child_process';

export interface Provenance {
  author: string | null;
  commit: string | null;
}

export function readGitProvenance(cwd?: string): Provenance {
  const opts = { cwd, stdio: ['ignore', 'pipe', 'ignore'] as const };
  let author: string | null = null;
  let commit: string | null = null;
  try {
    author = execSync('git config user.email', opts).toString().trim() || null;
  } catch {
    /* ignore */
  }
  try {
    commit = execSync('git rev-parse HEAD', opts).toString().trim() || null;
  } catch {
    /* ignore */
  }
  return { author, commit };
}
