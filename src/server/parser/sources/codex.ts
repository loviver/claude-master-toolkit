import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, join } from 'path';
import { parseCodexRollout, type RolloutLine } from './codex-rollout.js';
import type { SessionSource } from './types.js';

const ROLLOUT_FILE = /^rollout-.*\.jsonl$/;

function parseJsonl<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // ignore malformed line (e.g. a partially written tail)
    }
  }
  return out;
}

/** `session_index.jsonl` holds thread names; the last entry per id wins. */
function loadTitles(home: string): Map<string, string> {
  const file = join(home, 'session_index.jsonl');
  const titles = new Map<string, string>();
  if (!existsSync(file)) return titles;
  for (const e of parseJsonl<{ id?: string; thread_name?: string }>(readFileSync(file, 'utf-8'))) {
    if (e.id && e.thread_name) titles.set(e.id, e.thread_name);
  }
  return titles;
}

/** Codex CLI: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<session>.jsonl`. */
export function createCodexSessionSource(
  { home = process.env.CODEX_HOME ?? join(homedir(), '.codex') }: { home?: string } = {},
): SessionSource {
  const sessionsDir = join(home, 'sessions');

  return {
    agent: 'codex',

    discover() {
      if (!existsSync(sessionsDir)) return [];
      return readdirSync(sessionsDir, { recursive: true, encoding: 'utf-8' })
        .filter((rel) => ROLLOUT_FILE.test(basename(rel)))
        .map((rel) => join(sessionsDir, rel))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    },

    watchGlobs: () => [join(sessionsDir, '**', 'rollout-*.jsonl')],

    owns: (filePath) => ROLLOUT_FILE.test(basename(filePath)),

    async read(filePath) {
      const lines = parseJsonl<RolloutLine>(await readFile(filePath, 'utf-8'));
      const titles = loadTitles(home);
      return parseCodexRollout(lines, { titleFor: (id) => titles.get(id) });
    },
  };
}

export const codexSessionSource = createCodexSessionSource();
