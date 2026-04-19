import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Paths ──

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

// ── CWD path encoding ──

/**
 * Encode a CWD path to Claude's project directory format.
 * /home/user/code → -home-user-code
 */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

// ── Project directory discovery ──

/**
 * Find all project directories under ~/.claude/projects/
 */
export function listProjectDirs(): string[] {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return [];
  return readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(CLAUDE_PROJECTS_DIR, d.name));
}

/**
 * Find all .jsonl session files in a project directory, sorted newest first.
 */
export function listSessionFiles(projectDir: string): string[] {
  if (!existsSync(projectDir)) return [];
  return readdirSync(projectDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(projectDir, f))
    .sort((a, b) => {
      const sa = statSync(a).mtimeMs;
      const sb = statSync(b).mtimeMs;
      return sb - sa;
    });
}

/**
 * Get the latest session file for the current project (or a given CWD).
 */
export function getLatestSessionFile(cwd?: string): string | null {
  const projectCwd = cwd ?? process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
  const encoded = encodeCwd(projectCwd);
  const projectDir = join(CLAUDE_PROJECTS_DIR, encoded);
  const files = listSessionFiles(projectDir);
  return files[0] ?? null;
}
