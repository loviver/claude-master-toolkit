import { execFileSync } from 'child_process';

/**
 * A contiguous block of new-file lines the diff added or touched, attributed to
 * one file. `added` is the count of `+` lines (0 for a pure deletion).
 */
export interface TouchedRange {
  file: string;
  start: number;
  end: number;
  added: number;
}

// `@@ -a,b +c,d @@` — capture the new-side start (c) and optional count (d).
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse `git diff --unified=0` text into touched ranges on the NEW side. Pure —
 * no git, no IO. The scorer's blast-radius mapping only cares about new-file
 * line coordinates, so the `-` side is ignored.
 *
 * A wholly deleted file (`+++ /dev/null`) contributes nothing: it has no new
 * tree to map symbols against. A pure deletion inside a surviving file (`+c,0`)
 * still yields a zero-width touch at line `c` so the enclosing symbol is caught.
 */
export function parseUnifiedDiff(text: string): TouchedRange[] {
  const ranges: TouchedRange[] = [];
  let file: string | null = null;

  for (const line of text.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim();
      file = path === '/dev/null' ? null : path.replace(/^b\//, '');
      continue;
    }

    const m = HUNK_RE.exec(line);
    if (!m || file === null) continue;

    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    // `+c,0` (pure deletion): collapse to a single touched line at `c`.
    const end = count === 0 ? start : start + count - 1;
    ranges.push({ file, start, end, added: count });
  }

  return ranges;
}

/**
 * Resolve the base branch to diff against: the remote's default HEAD, falling
 * back to `main`. Canonical home for the logic duplicated across the git CLI
 * command and the MCP handler.
 */
export function resolveBaseBranch(cwd: string = process.cwd()): string {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
    })
      .trim()
      .replace('origin/', '');
  } catch {
    return 'main';
  }
}

export interface TouchedRangesOpts {
  base?: string;
  cwd?: string;
}

/**
 * Thin git adapter: `git diff --unified=0 <base>...HEAD` → touched ranges.
 * The three-dot form diffs from the merge-base, matching `ctk git-changed`.
 */
export function getTouchedRanges(opts: TouchedRangesOpts = {}): TouchedRange[] {
  const cwd = opts.cwd ?? process.cwd();
  const base = opts.base ?? resolveBaseBranch(cwd);
  const diff = execFileSync('git', ['diff', '--unified=0', `${base}...HEAD`], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  });
  return parseUnifiedDiff(diff);
}
