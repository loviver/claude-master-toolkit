import { readdirSync } from 'fs';
import { join, relative, sep } from 'path';

/** Dependency, build and cache dirs: never source, often huge. Dot dirs are skipped too. */
export const IGNORE_DIRS = new Set([
  'node_modules', 'dist', '.git', 'target', '__pycache__',
  '.venv', 'venv', 'build', '.next', '.cache', 'vendor', 'coverage',
]);

function isIgnoredDir(name: string): boolean {
  return IGNORE_DIRS.has(name) || name.startsWith('.');
}

/** True when `absPath` lies under `root` and no directory between them is ignored. */
export function isIndexablePath(root: string, absPath: string): boolean {
  const rel = relative(root, absPath);
  if (rel === '' || rel.startsWith('..')) return false;
  const dirs = rel.split(sep).slice(0, -1);
  return !dirs.some(isIgnoredDir);
}

export function walkDir(root: string, match: (file: string) => boolean, out: string[] = []): string[] {
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(root, e.name);
    if (e.isDirectory()) {
      if (isIgnoredDir(e.name)) continue;
      walkDir(full, match, out);
    } else if (e.isFile() && match(full)) {
      out.push(full);
    }
  }
  return out;
}
