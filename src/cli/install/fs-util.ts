import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';

/** Copies `file` into `backupDir` (timestamped). Returns the backup path, or null if there was nothing to back up. */
export function backupFile(file: string, backupDir: string): string | null {
  if (!existsSync(file)) return null;
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(backupDir, `${basename(file)}.${stamp}`);
  copyFileSync(file, dest);
  return dest;
}

/** Write via tmp + rename so a crash never leaves a half-written user config. Keeps the original mode. */
export function atomicWrite(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const mode = existsSync(file) ? statSync(file).mode & 0o777 : undefined;
  const tmp = `${file}.ctk-tmp-${process.pid}`;
  writeFileSync(tmp, content, mode !== undefined ? { mode } : undefined);
  renameSync(tmp, file);
}
