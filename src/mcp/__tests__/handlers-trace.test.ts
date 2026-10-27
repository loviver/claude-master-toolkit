import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handlers, closeSharedDb } from '../handlers.js';

let tmp: string;
let saved: Record<string, string | undefined>;

const ENV = ['CTK_HOME', 'CTK_MCP_TRACE'];

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  tmp = mkdtempSync(join(tmpdir(), 'ctk-mcp-trace-'));
  process.env['CTK_HOME'] = tmp;
});

afterEach(() => {
  closeSharedDb();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

function captureStderr(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  return lines;
}

const traceLines = (lines: string[]) =>
  lines.filter((l) => l.startsWith('[ctk-mcp:trace] ')).map((l) => JSON.parse(l.slice('[ctk-mcp:trace] '.length)));

describe('CTK_MCP_TRACE', () => {
  it('writes one stderr line per tool call with tool, ms split, bytes and connection reuse', () => {
    process.env['CTK_MCP_TRACE'] = '1';
    const lines = captureStderr();

    handlers.ctk_find({ name: 'nope', cwd: '/nowhere' });
    handlers.ctk_find({ name: 'nope', cwd: '/nowhere' });

    const [first, second] = traceLines(lines);
    expect(first).toMatchObject({ tool: 'ctk_find', reused: false });
    expect(second).toMatchObject({ tool: 'ctk_find', reused: true, openMs: 0 });
    for (const t of [first, second]) {
      expect(t.queryMs).toBeGreaterThanOrEqual(0);
      expect(t.bytes).toBeGreaterThan(0);
    }
  });

  it('never writes to stdout (it carries the stdio protocol)', () => {
    process.env['CTK_MCP_TRACE'] = '1';
    captureStderr();
    const out = vi.spyOn(process.stdout, 'write');

    handlers.ctk_find({ name: 'nope', cwd: '/nowhere' });

    expect(out).not.toHaveBeenCalled();
  });

  it('is silent when the flag is off', () => {
    delete process.env['CTK_MCP_TRACE'];
    const lines = captureStderr();

    handlers.ctk_find({ name: 'nope', cwd: '/nowhere' });

    expect(traceLines(lines)).toEqual([]);
  });
});

describe('shared DB connection', () => {
  it('reopens transparently after closeSharedDb()', () => {
    process.env['CTK_MCP_TRACE'] = '1';
    const lines = captureStderr();

    handlers.ctk_find({ name: 'a', cwd: '/nowhere' });
    closeSharedDb();
    handlers.ctk_find({ name: 'a', cwd: '/nowhere' });

    expect(traceLines(lines).map((t) => t.reused)).toEqual([false, false]);
  });
});
