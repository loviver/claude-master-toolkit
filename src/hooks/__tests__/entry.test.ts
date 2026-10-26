import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { runHook, parseArgs } from '../entry.js';

const entryPath = join(__dirname, '..', 'entry.ts');
const run = (args: string[], stdin: string, env: Record<string, string> = {}) =>
  spawnSync('node', ['--import', 'tsx', entryPath, ...args], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

describe('parseArgs', () => {
  it('event + --agent', () => {
    expect(parseArgs(['pre-tool-use', '--agent', 'codex'])).toEqual({ event: 'PreToolUse', agent: 'codex' });
    expect(parseArgs(['SessionStart', '--agent=claude-code'])).toEqual({ event: 'SessionStart', agent: 'claude-code' });
    expect(parseArgs(['stop'])).toEqual({ event: 'Stop' });
    expect(parseArgs([])).toEqual({});
  });
});

describe('runHook', () => {
  const commit = JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's',
    cwd: '/tmp',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "x" -m "Co-Authored-By: a"' },
  });

  it('blocks via the bash guard', async () => {
    const o = await runHook({ event: 'PreToolUse', agent: 'claude-code' }, commit);
    expect(o.exitCode).toBe(2);
    expect(o.stderr).toContain('✗ Blocked: git commit contains AI attribution.');
  });

  it('empty / broken stdin => silent exit 0', async () => {
    expect(await runHook({ event: 'PreToolUse', agent: 'claude-code' }, '')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
    expect(await runHook({ event: 'PreToolUse', agent: 'claude-code' }, '{nope')).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('unknown event / unknown agent => silent exit 0', async () => {
    expect((await runHook({ event: 'Wat' as never, agent: 'claude-code' }, '{}')).exitCode).toBe(0);
    expect((await runHook({ event: 'Stop', agent: 'nope' }, '{}')).exitCode).toBe(0);
  });

  it('argv event wins over payload event', async () => {
    const o = await runHook({ event: 'PreCompact', agent: 'claude-code' }, JSON.stringify({ hook_event_name: 'Stop', trigger: 'auto' }));
    expect(JSON.parse(o.stdout).systemMessage).toContain('Compaction (auto)');
  });
});

describe('process entry', () => {
  const commit = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "Co-Authored-By: a"' },
  });

  it('exit code + stderr reach the process boundary', () => {
    const r = run(['PreToolUse', '--agent', 'claude-code'], commit);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('✗ Blocked');
  });

  it('stdout JSON for PreCompact', () => {
    const r = run(['pre-compact'], JSON.stringify({ trigger: 'manual' }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).systemMessage).toContain('manual');
  });
});
