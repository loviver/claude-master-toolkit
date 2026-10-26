import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'fs';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { join } from 'path';
import { tmpdir } from 'os';
import type { HookEvent } from '../../runtime/types.js';
import { stopHandler } from '../stop.js';
import { sessionEndHandler } from '../session-end.js';
import { postToolUseHandler } from '../post-tool-use.js';
import { preToolUseHandler } from '../pre-tool-use.js';
import { userPromptSubmitHandler } from '../user-prompt-submit.js';
import { sessionStartHandler } from '../session-start.js';
import { ctkPaths } from '../../../shared/paths/ctk-home-paths.js';

let tmp: string;
const KEYS = ['CTK_HOME', 'HOME', 'PATH', 'CTK_PORT', 'CTK_REINDEX_SYNC', 'CTK_REINDEX_SENTINEL', 'CTK_HOOK_EDIT_SKILL_INJECT', 'CLAUDE_CONTEXT_WINDOW'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  tmp = mkdtempSync(join(tmpdir(), 'ctk-cdx-hooks-'));
  process.env['CTK_HOME'] = join(tmp, 'ctk');
  process.env['HOME'] = tmp;
  process.env['CTK_PORT'] = '1';
  delete process.env['CLAUDE_CONTEXT_WINDOW'];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

const SID = '01a17964-99a8-7d63-88cf-e4c3efb016c3';
const ev = (over: Partial<HookEvent>): HookEvent => ({
  agent: 'codex',
  event: 'PreToolUse',
  sessionId: SID,
  cwd: tmp,
  raw: {},
  ...over,
});
const sh = (command: string, event: HookEvent['event'] = 'PreToolUse') =>
  ev({ event, tool: { canonical: 'shell', rawName: 'Bash', input: { command }, command } });

describe('PreToolUse on Codex Bash', () => {
  beforeEach(() => {
    mkdirSync(join(tmp, 'sk'));
    writeFileSync(join(tmp, 'sk', 'SKILL.md'), '---\nname: ts-style\ndescription: d\npaths: src/**/*.ts\n---\n');
    mkdirSync(join(tmp, '.ctk'));
    writeFileSync(
      join(tmp, '.ctk', 'skill-registry.md'),
      `| Name | Source | Description | Path |\n|---|---|---|---|\n| ts-style | project | d | ${join(tmp, 'sk', 'SKILL.md')} |\n`,
    );
  });

  it.each([
    "printf 'x' > src/a.ts",
    'echo x | tee src/a.ts',
    "sed -i 's/a/b/' src/a.ts",
  ])('skill hint when a shell command writes a matching file: %s', async (cmd) => {
    const r = await preToolUseHandler(sh(cmd));
    expect((r as { text: string }).text).toContain('load ts-style (trigger: src/**/*.ts)');
  });

  it('read-only / non-matching commands: no hint', async () => {
    expect(await preToolUseHandler(sh('ls src'))).toEqual({ kind: 'noop' });
    expect(await preToolUseHandler(sh('echo x > README.md'))).toEqual({ kind: 'noop' });
  });

  it('CTK_HOOK_EDIT_SKILL_INJECT=0 disables the hint', async () => {
    process.env['CTK_HOOK_EDIT_SKILL_INJECT'] = '0';
    expect(await preToolUseHandler(sh('printf x > src/a.ts'))).toEqual({ kind: 'noop' });
  });

  it('the commit-attribution block still wins over hints', async () => {
    const r = await preToolUseHandler(sh('echo x > src/a.ts && git commit -m "Co-Authored-By: a"'));
    expect(r.kind).toBe('block');
  });

  it('apply_patch / mcp / spawn: noop (no verified payload to read)', async () => {
    for (const [canonical, rawName] of [
      ['other', 'apply_patch'],
      ['mcp', 'mcp__ctk__ctk_find'],
      ['agent', 'collaborationspawn_agent'],
    ] as const) {
      expect(await preToolUseHandler(ev({ tool: { canonical, rawName, input: {} } }))).toEqual({ kind: 'noop' });
    }
  });
});

describe('PostToolUse reindex on Codex Bash', () => {
  let sentinel: string;
  beforeEach(() => {
    const bin = join(tmp, 'bin');
    mkdirSync(bin);
    sentinel = join(tmp, 'sentinel');
    writeFileSync(join(bin, 'ctk'), '#!/bin/sh\necho "$@" >> "$CTK_REINDEX_SENTINEL"\n');
    chmodSync(join(bin, 'ctk'), 0o755);
    process.env['PATH'] = `${bin}:${saved['PATH']}`;
    process.env['CTK_REINDEX_SENTINEL'] = sentinel;
    process.env['CTK_REINDEX_SYNC'] = '1';
    mkdirSync(join(tmp, '.ctk'));
    writeFileSync(join(tmp, '.ctk', 'init.marker'), '');
  });

  it.each([
    "printf 'x' > a.ts",
    'echo x >> src/b.py',
    'echo x | tee c.go',
    "sed -i 's/a/b/' d.rs",
    'bash -c "echo x > e.tsx"',
  ])('reindexes after: %s', async (cmd) => {
    await postToolUseHandler(sh(cmd, 'PostToolUse'));
    expect(readFileSync(sentinel, 'utf8')).toContain('index build');
  });

  it.each(['ls -la', 'echo x > notes.md', 'cat a.ts', "sed 's/a/b/' a.ts", 'echo x > /dev/null'])('no reindex: %s', async (cmd) => {
    await postToolUseHandler(sh(cmd, 'PostToolUse'));
    expect(existsSync(sentinel)).toBe(false);
  });
});

describe('Stop / SessionEnd on Codex', () => {
  let server: Server;
  let hits: number;
  beforeEach(async () => {
    hits = 0;
    server = createServer((_req, res) => {
      hits++;
      res.end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env['CTK_PORT'] = String((server.address() as AddressInfo).port);
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it('no session sync until the Codex rollout parser exists (Phase 7); Claude still syncs', async () => {
    await stopHandler(ev({ event: 'Stop' }));
    await sessionEndHandler(ev({ event: 'SessionEnd', reason: 'other' }));
    expect(hits).toBe(0);
    await stopHandler(ev({ event: 'Stop', agent: 'claude-code' }));
    expect(hits).toBe(1);
  });

  it('no edit/save nag on Codex (the rollout format is not the Claude transcript)', async () => {
    const t = join(tmp, 'rollout.jsonl');
    writeFileSync(t, Array(5).fill('{"name":"Edit"}').join('\n'));
    expect(await stopHandler(ev({ event: 'Stop', transcriptPath: t }))).toEqual({ kind: 'noop' });
  });

  it('SessionEnd is idempotent and never purges for reason "other" (Codex sends it more than once)', async () => {
    const dir = ctkPaths.hookState('codex', SID);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 3; i++) await sessionEndHandler(ev({ event: 'SessionEnd', reason: 'other' }));
    expect(existsSync(dir)).toBe(true);
  });
});

describe('UserPromptSubmit context warning on Codex (rollout token_count)', () => {
  const rollout = (total: number, window?: number) => {
    const p = join(tmp, 'rollout.jsonl');
    const line = (o: unknown) => JSON.stringify(o);
    writeFileSync(
      p,
      [
        line({ type: 'session_meta', payload: { id: 'x' } }),
        line({
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: { last_token_usage: { input_tokens: total - 100, output_tokens: 100, total_tokens: total }, model_context_window: window },
          },
        }),
        line({ type: 'event_msg', payload: { type: 'task_complete' } }),
      ].join('\n') + '\n',
    );
    return p;
  };
  const up = (t: string) => ev({ event: 'UserPromptSubmit', prompt: 'hola', transcriptPath: t, model: 'gpt-6-luna' });

  it('uses the window Codex reports (258400), not 200k', async () => {
    const r = await userPromptSubmitHandler(up(rollout(190_000, 258_400))); // 73%
    const t = (r as { text: string }).text;
    expect(t).toContain('threshold crossed');
    expect(t).toContain('Usage: 73% (approx 190000 tokens of 258400)');
    expect(t).not.toContain('Realized cost'); // `ctk cost` is Claude-session based
  });

  it('below 70% of the reported window => silent; once per level', async () => {
    expect(await userPromptSubmitHandler(up(rollout(100_000, 258_400)))).toEqual({ kind: 'noop' });
    await userPromptSubmitHandler(up(rollout(190_000, 258_400)));
    expect(await userPromptSubmitHandler(up(rollout(190_000, 258_400)))).toEqual({ kind: 'noop' });
  });

  it('no token_count yet (fresh session) => noop', async () => {
    const p = join(tmp, 'r.jsonl');
    writeFileSync(p, '{"type":"session_meta","payload":{"id":"x"}}\n');
    expect(await userPromptSubmitHandler(up(p))).toEqual({ kind: 'noop' });
  });
});

describe('SessionStart on Codex', () => {
  it('no "prior session" guardian (Claude project layout only); reminder has no /delegate', async () => {
    mkdirSync(join(tmp, 'bin'));
    writeFileSync(join(tmp, 'bin', 'ctk'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(tmp, 'bin', 'ctk'), 0o755);
    process.env['PATH'] = `${join(tmp, 'bin')}:${saved['PATH']}`;
    const r = await sessionStartHandler(ev({ event: 'SessionStart', source: 'startup' }));
    const t = (r as { text: string }).text;
    expect(t).toContain('ctk MCP active');
    expect(t).not.toContain('Context Guardian');
    expect(t).not.toContain('/delegate');
  });
});
