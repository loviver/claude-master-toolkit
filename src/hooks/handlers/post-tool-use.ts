import { existsSync } from 'fs';
import { extname, join } from 'path';
import type { HookHandler } from '../runtime/types.js';
import { reindex } from '../lib/reindex.js';

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs']);

export const postToolUseHandler: HookHandler = (e) => {
  if (process.env['CTK_HOOK_REINDEX'] === '0') return { kind: 'noop' };
  const t = e.tool;
  if (!t || (t.canonical !== 'edit' && t.canonical !== 'write')) return { kind: 'noop' };
  if (!t.filePaths?.some((f) => SOURCE_EXT.has(extname(f)))) return { kind: 'noop' };
  if (!existsSync(join(e.cwd, '.ctk', 'init.marker'))) return { kind: 'noop' };
  reindex(e.cwd);
  return { kind: 'noop' };
};
