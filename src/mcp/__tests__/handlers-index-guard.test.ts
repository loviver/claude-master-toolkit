import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handlers, closeSharedDb } from '../handlers.js';
import { openDb } from '../../shared/indexer/db-raw.js';

const PROJECT = '/proj';
let tmp: string;
let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env['CTK_HOME'];
  tmp = mkdtempSync(join(tmpdir(), 'ctk-mcp-guard-'));
  process.env['CTK_HOME'] = tmp;
});

afterEach(() => {
  closeSharedDb();
  if (savedHome === undefined) delete process.env['CTK_HOME'];
  else process.env['CTK_HOME'] = savedHome;
  rmSync(tmp, { recursive: true, force: true });
});

const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

function markIndexed(): void {
  const db = openDb();
  db.prepare(`INSERT INTO indexed_files (project_path, file, hash, indexed_at) VALUES (?, 'a.ts', 'h', 0)`).run(PROJECT);
  db.close();
}

describe('index guard — an unindexed project is an error, not an empty answer', () => {
  it.each([
    ['ctk_find', () => handlers.ctk_find({ name: 'x', cwd: PROJECT })],
    ['ctk_callers', () => handlers.ctk_callers({ symbol: 'x', cwd: PROJECT })],
    ['ctk_deps', () => handlers.ctk_deps({ file: 'a.ts', cwd: PROJECT })],
  ])('%s tells the agent to build the index', (_name, call) => {
    const res = call() as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(parse(res).error).toContain(`ctk index build --path ${PROJECT}`);
  });

  it('an indexed project with no match returns an empty result, not an error', () => {
    markIndexed();
    const res = handlers.ctk_find({ name: 'x', cwd: PROJECT }) as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBeUndefined();
    expect(parse(res)).toEqual({ matches: [] });
  });
});
