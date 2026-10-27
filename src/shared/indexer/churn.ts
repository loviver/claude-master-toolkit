import { execFileSync } from 'child_process';

/** Recent history only: a file rewritten two years ago is not a hotspot today. */
export const CHURN_DAYS = 90;

/**
 * Commits per file from `git log --name-only --format=` output. `prefix` is the project's
 * path inside the repo (`git rev-parse --show-prefix`), stripped so keys match index paths;
 * files outside it are dropped.
 */
export function parseChurnLog(out: string, prefix = ''): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of out.split('\n')) {
    if (!line || !line.startsWith(prefix)) continue;
    const file = line.slice(prefix.length);
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}

/** Per-file commit count over the last `days`; empty when the project is not a git repo. */
export function fileChurn(projectPath: string, days = CHURN_DAYS): Map<string, number> {
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: projectPath, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const prefix = git(['rev-parse', '--show-prefix']).trim();
    return parseChurnLog(git(['log', `--since=${days}.days`, '--name-only', '--format=', '--', '.']), prefix);
  } catch {
    return new Map();
  }
}
