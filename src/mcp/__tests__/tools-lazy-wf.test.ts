import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { migrate } from '../../shared/db/migrate.js';
import { closeDb } from '../../shared/db/db.js';
import { registerTools } from '../tools.js';

describe('wf_* tools are loaded lazily', () => {
  let tmpDir: string;
  let saved: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctk-lazywf-'));
    saved = process.env['CTK_DB_PATH'];
    process.env['CTK_DB_PATH'] = join(tmpDir, 'ctk.sqlite');
    migrate();
  });

  afterEach(() => {
    closeDb();
    if (saved !== undefined) process.env['CTK_DB_PATH'] = saved;
    else delete process.env['CTK_DB_PATH'];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tools.ts has no static import of workflow-tools (it drags drizzle-orm into MCP cold start)', () => {
    const src = readFileSync(new URL('../tools.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^import[^;]*from\s+['"]\.\/workflow-tools\.js['"]/m);
  });

  it('still registers every wf_* tool and serves a call through the lazy loader', async () => {
    const callbacks = new Map<string, (args: unknown) => unknown>();
    const fake = {
      registerTool: (name: string, _cfg: unknown, cb: (args: unknown) => unknown) => {
        callbacks.set(name, cb);
      },
    } as unknown as McpServer;

    registerTools(fake);

    const wf = [...callbacks.keys()].filter((n) => n.startsWith('wf_')).sort();
    expect(wf).toEqual([
      'wf_create', 'wf_execute', 'wf_generate', 'wf_get', 'wf_list', 'wf_mutate', 'wf_mutation_log', 'wf_status', 'wf_update',
    ]);

    const res = (await callbacks.get('wf_list')!({})) as { content: Array<{ text: string }> };
    expect(JSON.parse(res.content[0]!.text)).toBeDefined();
  });
});
