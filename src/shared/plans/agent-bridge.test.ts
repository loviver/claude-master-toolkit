import { describe, it, expect } from 'vitest';
import {
  ClaudeCliAgentBridge,
  NullAgentBridge,
  type AgentInvocation,
} from './agent-bridge.js';
import type { CliRunner } from './runners.js';

const inv = (over: Partial<AgentInvocation> = {}): AgentInvocation => ({
  prompt: 'do the thing',
  execution_id: 'e1',
  plan_id: 'p1',
  current_node_id: 'n1',
  ...over,
});

function fakeRunner(result: { stdout?: string; stderr?: string; exitCode?: number | null }) {
  const calls: Array<{ args: string[]; input: string; cwd?: string; timeoutMs?: number }> = [];
  const run: CliRunner = async (args, opts) => {
    calls.push({ args, input: opts.input, cwd: opts.cwd, timeoutMs: opts.timeoutMs });
    return { stdout: '', stderr: '', exitCode: 0, ...result };
  };
  return { run, calls };
}

describe('NullAgentBridge', () => {
  it('labels its output as a dry run instead of pretending success', async () => {
    const out = (await new NullAgentBridge().invoke(inv())).output as Record<string, unknown>;
    expect(out.status).toBe('dry-run');
    expect(out.invoked).toBe(false);
  });
});

describe('ClaudeCliAgentBridge', () => {
  it('sends the prompt over stdin, never in argv', async () => {
    const { run, calls } = fakeRunner({ stdout: JSON.stringify({ result: 'ok', is_error: false }) });
    await new ClaudeCliAgentBridge({ run }).invoke(inv({ prompt: 'SECRET-BRIEF' }));
    expect(calls[0].input).toBe('SECRET-BRIEF');
    expect(calls[0].args.join(' ')).not.toContain('SECRET-BRIEF');
    expect(calls[0].args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json']));
  });

  it('maps model, subagent, whitelist, permission mode, cwd and timeout', async () => {
    const { run, calls } = fakeRunner({ stdout: JSON.stringify({ result: 'ok' }) });
    await new ClaudeCliAgentBridge({ run }).invoke(
      inv({
        model: 'opus',
        subagent_type: 'builder',
        toolWhitelist: ['Bash', 'Edit'],
        permissionMode: 'acceptEdits',
        cwd: '/repo',
        timeoutMs: 1234,
      }),
    );
    const { args, cwd, timeoutMs } = calls[0];
    expect(args).toEqual(expect.arrayContaining(['--model', 'opus', '--agent', 'builder']));
    expect(args).toEqual(expect.arrayContaining(['--allowedTools', 'Bash,Edit']));
    expect(args).toEqual(expect.arrayContaining(['--permission-mode', 'acceptEdits']));
    expect(cwd).toBe('/repo');
    expect(timeoutMs).toBe(1234);
  });

  it('omits --model when inherit and --agent when absent', async () => {
    const { run, calls } = fakeRunner({ stdout: JSON.stringify({ result: 'ok' }) });
    await new ClaudeCliAgentBridge({ run }).invoke(inv({ model: 'inherit' }));
    expect(calls[0].args).not.toContain('--model');
    expect(calls[0].args).not.toContain('--agent');
  });

  it('returns the agent result text and cost on success', async () => {
    const { run } = fakeRunner({
      stdout: JSON.stringify({ result: 'merged', is_error: false, total_cost_usd: 1.5 }),
    });
    const res = await new ClaudeCliAgentBridge({ run }).invoke(inv());
    expect(res.error).toBeUndefined();
    expect(res.output).toMatchObject({ status: 'completed', result: 'merged', costUsd: 1.5 });
  });

  it('reports an error when the agent says is_error', async () => {
    const { run } = fakeRunner({ stdout: JSON.stringify({ result: 'boom', is_error: true }) });
    const res = await new ClaudeCliAgentBridge({ run }).invoke(inv());
    expect(res.error).toMatch(/boom/);
  });

  it('reports an error on non-zero exit, including a stderr tail', async () => {
    const { run } = fakeRunner({ exitCode: 1, stderr: 'permission denied for Bash' });
    const res = await new ClaudeCliAgentBridge({ run }).invoke(inv());
    expect(res.error).toMatch(/exit code 1/);
    expect(res.error).toMatch(/permission denied/);
  });

  it('reports an error when stdout is not JSON', async () => {
    const { run } = fakeRunner({ stdout: 'not json' });
    const res = await new ClaudeCliAgentBridge({ run }).invoke(inv());
    expect(res.error).toMatch(/parse/i);
  });

  it('reports a timeout when the runner returns a null exit code', async () => {
    const { run } = fakeRunner({ exitCode: null });
    const res = await new ClaudeCliAgentBridge({ run }).invoke(inv());
    expect(res.error).toMatch(/timed out|killed/i);
  });
});
