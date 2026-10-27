import { existsSync, readFileSync, unlinkSync } from 'fs';
import { parse } from 'smol-toml';
import { atomicWrite, backupFile } from './fs-util.js';

export class TomlConflictError extends Error {}

const begin = (id: string) => `# >>> ctk:${id} (managed by ctk, do not edit) >>>`;
const end = (id: string) => `# <<< ctk:${id} <<<`;

function blockRegExp(id: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\n?${esc(begin(id))}\\n[\\s\\S]*?${esc(end(id))}\\n?`);
}

type Table = Record<string, unknown>;

/** Throws if `body` defines a key (two levels deep) the user already owns outside the block. */
function assertNoConflict(outside: string, body: string): void {
  const have = parse(outside) as Table;
  const want = parse(body) as Table;
  for (const [k, v] of Object.entries(want)) {
    const existing = have[k];
    if (existing === undefined) continue;
    if (typeof v !== 'object' || v === null || typeof existing !== 'object' || existing === null) {
      throw new TomlConflictError(`config already defines "${k}"`);
    }
    for (const sub of Object.keys(v as Table)) {
      if ((existing as Table)[sub] !== undefined) throw new TomlConflictError(`config already defines "${k}.${sub}"`);
    }
  }
}

/**
 * Inserts/replaces a ctk-owned block at the end of a TOML file without re-serializing it:
 * the user's comments, ordering and tables we know nothing about (e.g. `[hooks.state.*]`
 * trust entries) stay byte-for-byte. The result is validated before anything is written.
 */
export function upsertManagedBlock(
  file: string,
  id: string,
  body: string,
  opts: { backupDir: string },
): { changed: boolean; created: boolean } {
  const existed = existsSync(file);
  const original = existed ? readFileSync(file, 'utf8') : '';
  const re = blockRegExp(id);
  const outside = original.replace(re, '');

  parse(body); // body itself must be valid
  if (outside.trim()) assertNoConflict(outside, body);

  const block = `${begin(id)}\n${body.endsWith('\n') ? body : body + '\n'}${end(id)}\n`;
  let next: string;
  if (re.test(original)) next = original.replace(re, (m) => (m.startsWith('\n') ? '\n' : '') + block);
  else next = original + (original === '' || original.endsWith('\n\n') ? '' : original.endsWith('\n') ? '\n' : '\n\n') + block;

  parse(next); // never write something the agent cannot load
  if (next === original) return { changed: false, created: false };

  if (existed) backupFile(file, opts.backupDir);
  atomicWrite(file, next);
  return { changed: true, created: !existed };
}

export function removeManagedBlock(file: string, id: string, opts: { deleteIfEmpty?: boolean } = {}): boolean {
  if (!existsSync(file)) return false;
  const original = readFileSync(file, 'utf8');
  const re = blockRegExp(id);
  if (!re.test(original)) return false;
  const next = original.replace(re, '');
  if (opts.deleteIfEmpty && next.trim() === '') unlinkSync(file);
  else atomicWrite(file, next);
  return true;
}
