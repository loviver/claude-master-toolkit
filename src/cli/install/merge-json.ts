import { existsSync, readFileSync } from 'fs';
import { atomicWrite, backupFile } from './fs-util.js';

type Json = Record<string, unknown>;

function load(file: string): Json {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON object`);
  }
  return parsed as Json;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Sets `value` at `path`, creating the file/parents as needed. Throws (file untouched) on invalid JSON. */
export function setJsonKey(
  file: string,
  path: string[],
  value: unknown,
  opts: { backupDir: string },
): { changed: boolean; created: boolean } {
  const existed = existsSync(file);
  const root = existed ? load(file) : {};

  let cur = root;
  for (const key of path.slice(0, -1)) {
    const next = cur[key];
    cur = (typeof next === 'object' && next !== null && !Array.isArray(next) ? next : (cur[key] = {})) as Json;
  }
  const last = path[path.length - 1]!;
  if (same(cur[last], value)) return { changed: false, created: false };
  cur[last] = value;

  if (existed) backupFile(file, opts.backupDir);
  atomicWrite(file, JSON.stringify(root, null, 2) + '\n');
  return { changed: true, created: !existed };
}

export function removeJsonKey(file: string, path: string[]): boolean {
  if (!existsSync(file)) return false;
  const root = load(file);
  const chain: Json[] = [root];
  for (const key of path.slice(0, -1)) {
    const next = (chain[chain.length - 1] as Json)[key];
    if (typeof next !== 'object' || next === null) return false;
    chain.push(next as Json);
  }
  const last = path[path.length - 1]!;
  const parent = chain[chain.length - 1] as Json;
  if (!(last in parent)) return false;
  delete parent[last];

  // Prune parents that became empty because of us (keeps the file as the user had it).
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i] as Json).length > 0) break;
    delete (chain[i - 1] as Json)[path[i - 1]!];
  }
  if (Object.keys(root).length === 0 && path.length === 1) {
    atomicWrite(file, '{}\n');
    return true;
  }
  atomicWrite(file, JSON.stringify(root, null, 2) + '\n');
  return true;
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Objects merge recursively; arrays union (user items kept, patch items added once); scalars: patch wins. */
function mergeInto(base: Json, patch: Json): void {
  for (const [k, v] of Object.entries(patch)) {
    const cur = base[k];
    if (isObj(v) && isObj(cur)) mergeInto(cur, v);
    else if (Array.isArray(v) && Array.isArray(cur)) {
      for (const item of v) if (!cur.some((c) => same(c, item))) cur.push(item);
    } else base[k] = structuredClone(v);
  }
}

export function mergeJsonPatch(file: string, patch: Json, opts: { backupDir: string }): { changed: boolean; created: boolean } {
  const existed = existsSync(file);
  const root = existed ? load(file) : {};
  const before = JSON.stringify(root);
  mergeInto(root, patch);
  if (JSON.stringify(root) === before) return { changed: false, created: false };
  if (existed) backupFile(file, opts.backupDir);
  atomicWrite(file, JSON.stringify(root, null, 2) + '\n');
  return { changed: true, created: !existed };
}

/** Inverse of mergeJsonPatch: removes only what the patch contributed, prunes containers left empty. */
function subtract(base: Json, patch: Json): void {
  for (const [k, v] of Object.entries(patch)) {
    const cur = base[k];
    if (isObj(v) && isObj(cur)) {
      subtract(cur, v);
      if (Object.keys(cur).length === 0) delete base[k];
    } else if (Array.isArray(v) && Array.isArray(cur)) {
      base[k] = cur.filter((c) => !v.some((item) => same(c, item)));
      if ((base[k] as unknown[]).length === 0) delete base[k];
    } else if (same(cur, v)) delete base[k];
  }
}

export function unmergeJsonPatch(file: string, patch: Json): boolean {
  if (!existsSync(file)) return false;
  const root = load(file);
  const before = JSON.stringify(root);
  subtract(root, patch);
  if (JSON.stringify(root) === before) return false;
  atomicWrite(file, JSON.stringify(root, null, 2) + '\n');
  return true;
}
