import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../tools.js';

type Cb = (args: unknown) => unknown;
let callbacks: Map<string, Cb>;
let tmp: string;
let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env['CTK_HOME'];
  tmp = mkdtempSync(join(tmpdir(), 'ctk-mcp-mem-'));
  process.env['CTK_HOME'] = tmp;
  callbacks = new Map();
  registerTools({ registerTool: (name: string, _cfg: unknown, cb: Cb) => callbacks.set(name, cb) } as unknown as McpServer);
});

afterEach(() => {
  if (savedHome === undefined) delete process.env['CTK_HOME'];
  else process.env['CTK_HOME'] = savedHome;
  rmSync(tmp, { recursive: true, force: true });
});

const text = async (r: unknown) => JSON.parse(((await r) as { content: Array<{ text: string }> }).content[0].text);

describe('memory MCP surface', () => {
  it('exposes the six core mem_* tools and no legacy pandorica_* aliases', () => {
    const names = [...callbacks.keys()];
    expect(names.filter((n) => n.startsWith('mem_')).sort()).toEqual([
      'mem_context', 'mem_get', 'mem_recall', 'mem_save', 'mem_session', 'mem_trace',
    ]);
    expect(names.filter((n) => n.startsWith('pandorica_'))).toEqual([]);
  });

  it('mem_save → mem_get round-trips through the registered callbacks', async () => {
    const saved = await text(callbacks.get('mem_save')!({ title: 'Chose X', type: 'decision', what: 'because Y', project_path: '/p' }));
    expect(saved.id).toBeDefined();
    const got = await text(callbacks.get('mem_get')!({ id: saved.id }));
    expect(got.title).toBe('Chose X');
  });

  it('mem_session takes `action` (the documented name) and defaults the session id', async () => {
    const res = await text(callbacks.get('mem_session')!({ action: 'summary', content: '## Goal\nship', project_path: '/p' }));
    expect(res.saved).toBe(true);
  });
});
