import { execFileSync } from 'child_process';

/**
 * A contiguous block of new-file lines the diff added or touched, attributed to
 * one file. `added` is the count of `+` lines (0 for a pure deletion); `removed` the
 * count of `-` lines the hunk replaced (0 for a pure addition).
 */
export interface TouchedRange {
  file: string;
  start: number;
  end: number;
  added: number;
  removed: number;
}

// `@@ -a,b +c,d @@` — capture the old-side count (b) and the new-side start (c) and count (d).
const HUNK_RE = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse `git diff --unified=0` text into touched ranges on the NEW side. Pure —
 * no git, no IO. The scorer's blast-radius mapping only cares about new-file
 * line coordinates; of the `-` side only the line count is kept.
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

    const removed = m[1] === undefined ? 1 : Number(m[1]);
    const start = Number(m[2]);
    const count = m[3] === undefined ? 1 : Number(m[3]);
    // `+c,0` (pure deletion): collapse to a single touched line at `c`.
    const end = count === 0 ? start : start + count - 1;
    ranges.push({ file, start, end, added: count, removed });
  }

  return ranges;
}

/** One line of a reviewable hunk; `old`/`new` are its line number on each side, null where it has none. */
export interface DiffLine {
  kind: 'context' | 'add' | 'del';
  old: number | null;
  new: number | null;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  /** The enclosing declaration git prints after `@@` (may be empty). */
  section: string;
  lines: DiffLine[];
}

export interface FileDiff {
  status: 'added' | 'deleted' | 'modified';
  binary: boolean;
  hunks: DiffHunk[];
}

// `@@ -a[,b] +c[,d] @@ section` — old start, new start and the trailing section heading.
const HUNK_FULL_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

/**
 * Parse ONE file's `git diff` (any `--unified` width) into hunks a reviewer reads:
 * every line numbered on its own side. Pure — no git, no IO.
 */
export function parseFileDiff(text: string): FileDiff {
  const diff: FileDiff = { status: 'modified', binary: false, hunks: [] };
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of text.split('\n')) {
    const m = HUNK_FULL_RE.exec(line);
    if (m) {
      oldLine = Number(m[1]);
      newLine = Number(m[2]);
      hunk = { oldStart: oldLine, newStart: newLine, section: m[3].trim(), lines: [] };
      diff.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      // File header: only what it says about the file as a whole matters.
      if (line === '--- /dev/null' || line.startsWith('new file mode')) diff.status = 'added';
      else if (line === '+++ /dev/null' || line.startsWith('deleted file mode')) diff.status = 'deleted';
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') diff.binary = true;
      continue;
    }
    const mark = line[0];
    const body = line.slice(1);
    if (mark === '+') hunk.lines.push({ kind: 'add', old: null, new: newLine++, text: body });
    else if (mark === '-') hunk.lines.push({ kind: 'del', old: oldLine++, new: null, text: body });
    else if (mark === ' ') hunk.lines.push({ kind: 'context', old: oldLine++, new: newLine++, text: body });
    // `\ No newline at end of file` and the trailing empty split chunk carry no line.
  }
  return diff;
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
  /** Also count uncommitted (tracked) edits: diff the merge-base against the working tree. */
  worktree?: boolean;
}

/**
 * Thin git adapter: `git diff --unified=0 <base>...HEAD` → touched ranges.
 * The three-dot form diffs from the merge-base, matching `ctk git-changed`.
 * With `worktree`, `--merge-base <base>` diffs that same merge-base against the
 * working tree instead, so edits not yet committed show up too.
 */
export function getTouchedRanges(opts: TouchedRangesOpts = {}): TouchedRange[] {
  const cwd = opts.cwd ?? process.cwd();
  const base = opts.base ?? resolveBaseBranch(cwd);
  const range = opts.worktree ? ['--merge-base', base] : [`${base}...HEAD`];
  const diff = execFileSync('git', ['diff', '--unified=0', ...range], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  });
  return parseUnifiedDiff(diff);
}

/** `<base>...HEAD`, or the merge-base vs the working tree with `worktree` — same ranges as getTouchedRanges. */
function diffRange(base: string, worktree: boolean | undefined): string[] {
  return worktree ? ['--merge-base', base] : [`${base}...HEAD`];
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd, maxBuffer: 50 * 1024 * 1024 });
}

/** Repo-relative paths the diff touches (deleted files included). */
export function getChangedFiles(opts: TouchedRangesOpts = {}): string[] {
  const cwd = opts.cwd ?? process.cwd();
  const base = opts.base ?? resolveBaseBranch(cwd);
  return git(cwd, ['diff', '--name-only', ...diffRange(base, opts.worktree)]).split('\n').filter(Boolean);
}

export type FileStatus = 'added' | 'modified' | 'deleted';

/**
 * Parse `git diff --name-status` into a status per path. Pure. A rename counts as a
 * modification of the new path, a copy as an addition; anything else not A/D is modified.
 */
export function parseNameStatus(text: string): Map<string, FileStatus> {
  const out = new Map<string, FileStatus>();
  for (const line of text.split('\n')) {
    const [code, ...paths] = line.split('\t');
    const file = paths[paths.length - 1];
    if (!code || !file) continue;
    out.set(file, code[0] === 'A' || code[0] === 'C' ? 'added' : code[0] === 'D' ? 'deleted' : 'modified');
  }
  return out;
}

/** Status of every path the diff touches — same range as getChangedFiles. */
export function getFileStatuses(opts: TouchedRangesOpts = {}): Map<string, FileStatus> {
  const cwd = opts.cwd ?? process.cwd();
  const base = opts.base ?? resolveBaseBranch(cwd);
  return parseNameStatus(git(cwd, ['diff', '--name-status', ...diffRange(base, opts.worktree)]));
}

/**
 * One file's reviewable diff with `context` lines around each change. The path is a
 * literal pathspec after `--`: never an option, never a glob.
 */
export function getFileDiff(file: string, opts: TouchedRangesOpts & { context?: number } = {}): FileDiff {
  const cwd = opts.cwd ?? process.cwd();
  const base = opts.base ?? resolveBaseBranch(cwd);
  const text = git(cwd, [
    '--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', `--unified=${opts.context ?? 3}`,
    ...diffRange(base, opts.worktree), '--', file,
  ]);
  return parseFileDiff(text);
}
