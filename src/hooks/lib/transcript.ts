import { closeSync, existsSync, openSync, readSync, statSync, readFileSync } from 'fs';

const TAIL_BYTES = 512 * 1024;

function tail(path: string): string {
  const size = statSync(path).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** input + output + cache_read tokens of the last assistant turn that carries usage. */
export function lastTurnTokens(path: string | undefined): number {
  if (!path || !existsSync(path)) return 0;
  try {
    const lines = tail(path).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      if (!line.includes('"input_tokens"')) continue;
      try {
        const o = JSON.parse(line) as { message?: { usage?: Usage }; usage?: Usage };
        const u = o.message?.usage ?? o.usage;
        if (!u) continue;
        return (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      } catch {
        continue; // partial first line of the tail window
      }
    }
  } catch {
    /* fall through */
  }
  return 0;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Counts transcript lines mentioning any of the tool names as `"name":"<tool>"`. */
export function countToolCalls(path: string | undefined, names: string[]): number {
  if (!path || !existsSync(path)) return 0;
  const re = new RegExp(`"name":"(${names.join('|')})"`);
  let n = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) if (re.test(line)) n++;
  return n;
}

/**
 * Context in use per the last `token_count` of a Codex rollout. `total_tokens` already includes
 * cached input and reasoning (verified: total = input + output), and Codex reports its own window.
 */
export function lastCodexContext(path: string | undefined): { tokens: number; window?: number } {
  if (!path || !existsSync(path)) return { tokens: 0 };
  try {
    const lines = tail(path).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      if (!line.includes('token_count')) continue;
      try {
        const o = JSON.parse(line) as { payload?: { type?: string; info?: CodexInfo } };
        const info = o.payload?.type === 'token_count' ? o.payload.info : undefined;
        const last = info?.last_token_usage;
        if (!last) continue;
        const tokens = last.total_tokens ?? (last.input_tokens ?? 0) + (last.output_tokens ?? 0);
        return { tokens, window: info?.model_context_window || undefined };
      } catch {
        continue;
      }
    }
  } catch {
    /* fall through */
  }
  return { tokens: 0 };
}

interface CodexInfo {
  last_token_usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  model_context_window?: number;
}
