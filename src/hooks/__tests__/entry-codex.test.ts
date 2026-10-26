import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { runHook } from '../entry.js';

const raw = (n: string) => readFileSync(join(__dirname, 'fixtures', 'codex', `${n}.json`), 'utf8');
const entryPath = join(__dirname, '..', 'entry.ts');

describe('runHook --agent codex with real captured payloads', () => {
  it('PreToolUse Bash that embeds AI attribution in a commit => exit 2 + stderr (documented deny)', async () => {
    const p = JSON.parse(raw('PreToolUse'));
    p.tool_input.command = 'git commit -m "x" -m "Co-Authored-By: a"';
    const o = await runHook({ event: 'PreToolUse', agent: 'codex' }, JSON.stringify(p));
    expect(o.exitCode).toBe(2);
    expect(o.stderr).toContain('✗ Blocked: git commit contains AI attribution.');
    expect(o.stdout).toBe('');
  });

  it('captured PreToolUse / PostToolUse Bash payloads are silent noops', async () => {
    for (const n of ['PreToolUse', 'PostToolUse']) {
      expect(await runHook({ event: n as never, agent: 'codex' }, raw(n))).toEqual({ stdout: '', stderr: '', exitCode: 0 });
    }
  });

  it('subagent spawn (encrypted message): no brief hint, noop', async () => {
    expect(await runHook({ event: 'PreToolUse', agent: 'codex' }, raw('PreToolUse-spawn_agent'))).toEqual({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
  });

  it('apply_patch / MCP / PermissionRequest: noop until real captures exist', async () => {
    const base = JSON.parse(raw('PreToolUse'));
    const patch = { ...base, tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: a.ts\n+x\n*** End Patch' } };
    const mcp = { ...base, tool_name: 'mcp__ctk__ctk_find', tool_input: { q: 'x' } };
    const perm = { ...base, hook_event_name: 'PermissionRequest' };
    const silent = { stdout: '', stderr: '', exitCode: 0 };
    expect(await runHook({ event: 'PreToolUse', agent: 'codex' }, JSON.stringify(patch))).toEqual(silent);
    expect(await runHook({ event: 'PreToolUse', agent: 'codex' }, JSON.stringify(mcp))).toEqual(silent);
    expect(await runHook({ event: 'PermissionRequest' as never, agent: 'codex' }, JSON.stringify(perm))).toEqual(silent);
  });

  it('Stop never writes plain text to stdout (Codex rejects it)', async () => {
    const o = await runHook({ event: 'Stop', agent: 'codex' }, raw('Stop'));
    expect(o).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('SessionEnd fixture (reason "other"): silent and idempotent', async () => {
    for (let i = 0; i < 2; i++) {
      expect(await runHook({ event: 'SessionEnd', agent: 'codex' }, raw('SessionEnd'))).toEqual({ stdout: '', stderr: '', exitCode: 0 });
    }
  });

  it('process boundary: --agent codex via argv', () => {
    const p = JSON.parse(raw('PreToolUse'));
    p.tool_input.command = 'git commit -m "Co-Authored-By: a"';
    const r = spawnSync('node', ['--import', 'tsx', entryPath, 'PreToolUse', '--agent', 'codex'], {
      input: JSON.stringify(p),
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('✗ Blocked');
  });
});
