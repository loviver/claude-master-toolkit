import { describe, it, expect } from 'vitest';
import { PlanExecutor } from './executor.js';
import { applyMutation } from './mutate.js';
import type { AgentBridge, AgentInvocation, AgentResult } from './agent-bridge.js';
import type { PlanDefinition } from '../types/plan.js';

function mkDef(): PlanDefinition {
  return {
    entrypoint: 'a',
    nodes: [
      { id: 'a', type: 'task', label: 'A', config: { command: 'echo a' }, edges: [{ target: 'b' }] },
      { id: 'b', type: 'task', label: 'B', config: { command: 'echo b' }, edges: [] },
    ],
  };
}

describe('PlanExecutor — primitives', () => {
  it('executes task chain end-to-end', async () => {
    const exec = new PlanExecutor('p1', mkDef());
    const state = await exec.execute();
    expect(state.state).toBe('completed');
    expect(state.nodeStates.get('a')?.status).toBe('done');
    expect(state.nodeStates.get('b')?.status).toBe('done');
    expect(state.timeline.length).toBeGreaterThanOrEqual(4); // running+done per node
  });

  it('executes bash node via config.command', async () => {
    const def: PlanDefinition = {
      entrypoint: 'x',
      nodes: [
        { id: 'x', type: 'bash', label: 'X', config: { command: 'ls' }, edges: [] },
      ],
    };
    const exec = new PlanExecutor('p1', def);
    const state = await exec.execute();
    expect(state.state).toBe('completed');
    expect(state.nodeStates.get('x')?.output).toMatchObject({ command: 'ls' });
  });

  it('fails when bash node missing command', async () => {
    const def: PlanDefinition = {
      entrypoint: 'x',
      nodes: [{ id: 'x', type: 'bash', label: 'X', config: {}, edges: [] }],
    };
    const exec = new PlanExecutor('p1', def);
    const state = await exec.execute();
    expect(state.state).toBe('failed');
    expect(state.error).toMatch(/command/);
  });
});

describe('PlanExecutor — agent bridge', () => {
  it('invokes bridge with execution context + preamble', async () => {
    const invocations: AgentInvocation[] = [];
    const bridge: AgentBridge = {
      async invoke(inv: AgentInvocation): Promise<AgentResult> {
        invocations.push(inv);
        return { output: { ok: true } };
      },
    };
    const def: PlanDefinition = {
      entrypoint: 'a',
      nodes: [
        {
          id: 'a',
          type: 'agent',
          label: 'Agent',
          config: {
            subagent_type: 'Explore',
            prompt: 'map repo',
            toolWhitelist: ['Read', 'Grep'],
          },
          edges: [],
        },
      ],
    };
    const exec = new PlanExecutor('plan-123', def, { agentBridge: bridge });
    exec.setExecutionId('exec-abc');
    const state = await exec.execute();
    expect(state.state).toBe('completed');
    expect(invocations).toHaveLength(1);
    const inv = invocations[0]!;
    expect(inv.execution_id).toBe('exec-abc');
    expect(inv.plan_id).toBe('plan-123');
    expect(inv.current_node_id).toBe('a');
    expect(inv.prompt).toContain('execution_id: exec-abc');
    expect(inv.prompt).toContain('Allowed tools');
    expect(inv.prompt).toContain('map repo');
  });

  it('propagates bridge error as node failure', async () => {
    const bridge: AgentBridge = {
      async invoke(): Promise<AgentResult> {
        return { output: null, error: 'bridge boom' };
      },
    };
    const def: PlanDefinition = {
      entrypoint: 'a',
      nodes: [
        { id: 'a', type: 'agent', label: 'Agent', config: { prompt: 'x' }, edges: [] },
      ],
    };
    const exec = new PlanExecutor('p', def, { agentBridge: bridge });
    const state = await exec.execute();
    expect(state.state).toBe('failed');
    expect(state.error).toMatch(/bridge boom/);
  });
});

describe('PlanExecutor — live definition (mutable workflow)', () => {
  it('picks up node injected mid-execution via getLiveDefinition', async () => {
    let liveDef = mkDef();

    const bridge: AgentBridge = {
      async invoke(inv: AgentInvocation): Promise<AgentResult> {
        // First agent invocation triggers injection of a new node between a and b
        if (inv.current_node_id === 'a') {
          liveDef = applyMutation(liveDef, {
            op: 'addNode',
            after: 'a',
            node: {
              id: 'injected',
              type: 'task',
              label: 'Injected',
              config: { command: 'echo inject' },
              edges: [],
            },
          });
        }
        return { output: { mutated: true } };
      },
    };

    // Convert def so node 'a' is an agent that mutates
    const def: PlanDefinition = {
      entrypoint: 'a',
      nodes: [
        { id: 'a', type: 'agent', label: 'A', config: { prompt: 'mutate' }, edges: [{ target: 'b' }] },
        { id: 'b', type: 'task', label: 'B', config: { command: 'echo b' }, edges: [] },
      ],
    };
    liveDef = def;

    const exec = new PlanExecutor('p', def, {
      agentBridge: bridge,
      getLiveDefinition: () => liveDef,
    });

    const state = await exec.execute();

    expect(state.state).toBe('completed');
    const visited = state.timeline.filter((t) => t.status === 'done').map((t) => t.nodeId);
    expect(visited).toContain('a');
    expect(visited).toContain('injected');
    expect(visited).toContain('b');
    // ordering: injected must come after a and before b
    const aIdx = visited.indexOf('a');
    const injIdx = visited.indexOf('injected');
    const bIdx = visited.indexOf('b');
    expect(aIdx).toBeLessThan(injIdx);
    expect(injIdx).toBeLessThan(bIdx);
  });

  it('respects edge redirect via mutation mid-flight', async () => {
    let liveDef: PlanDefinition = {
      entrypoint: 'a',
      nodes: [
        { id: 'a', type: 'agent', label: 'A', config: { prompt: 'x' }, edges: [{ target: 'b' }] },
        { id: 'b', type: 'task', label: 'B', config: { command: 'echo b' }, edges: [] },
        { id: 'c', type: 'task', label: 'C', config: { command: 'echo c' }, edges: [] },
      ],
    };

    const bridge: AgentBridge = {
      async invoke(): Promise<AgentResult> {
        liveDef = applyMutation(liveDef, {
          op: 'redirectEdge',
          from: 'a',
          to: 'b',
          newTarget: 'c',
        });
        return { output: {} };
      },
    };

    const exec = new PlanExecutor('p', liveDef, {
      agentBridge: bridge,
      getLiveDefinition: () => liveDef,
    });
    const state = await exec.execute();

    expect(state.state).toBe('completed');
    expect(state.nodeStates.get('c')?.status).toBe('done');
    expect(state.nodeStates.get('b')?.status).toBe('pending');
  });
});

describe('PlanExecutor — live shell and dry-run labeling', () => {
  const bashDef = (cfg: Record<string, unknown>): PlanDefinition => ({
    entrypoint: 'x',
    nodes: [{ id: 'x', type: 'bash', label: 'X', config: cfg, edges: [] }],
  });

  it('labels bash as dry-run when no shell runner is injected', async () => {
    const state = await new PlanExecutor('p1', bashDef({ command: 'ls' })).execute();
    expect(state.nodeStates.get('x')?.output).toMatchObject({ status: 'dry-run' });
  });

  it('runs bash through the injected runner with node cwd and timeout', async () => {
    const calls: Array<{ command: string; cwd?: string; timeoutMs?: number }> = [];
    const shellRunner = async (command: string, opts: { cwd?: string; timeoutMs?: number }) => {
      calls.push({ command, ...opts });
      return { stdout: 'hi', stderr: '', exitCode: 0 };
    };
    const def = bashDef({ command: 'echo hi', cwd: '/repo' });
    def.nodes[0].timeout = 500;
    const state = await new PlanExecutor('p1', def, { shellRunner }).execute();
    expect(state.state).toBe('completed');
    expect(calls).toEqual([{ command: 'echo hi', cwd: '/repo', timeoutMs: 500 }]);
    expect(state.nodeStates.get('x')?.output).toMatchObject({ status: 'executed', exitCode: 0, stdout: 'hi' });
  });

  it('fails the node and the run on a non-zero exit', async () => {
    const shellRunner = async () => ({ stdout: '', stderr: 'gh: not found', exitCode: 127 });
    const state = await new PlanExecutor('p1', bashDef({ command: 'gh x' }), { shellRunner }).execute();
    expect(state.state).toBe('failed');
    expect(state.error).toMatch(/exit code 127/);
    expect(state.error).toMatch(/gh: not found/);
  });

  it('passes cwd, timeout and permissionMode from node config to the agent bridge', async () => {
    const seen: AgentInvocation[] = [];
    const agentBridge: AgentBridge = {
      async invoke(i): Promise<AgentResult> {
        seen.push(i);
        return { output: { status: 'completed' } };
      },
    };
    const def: PlanDefinition = {
      entrypoint: 'a',
      nodes: [
        {
          id: 'a',
          type: 'agent',
          label: 'A',
          timeout: 9000,
          config: { prompt: 'go', cwd: '/repo', permissionMode: 'acceptEdits' },
          edges: [],
        },
      ],
    };
    await new PlanExecutor('p1', def, { agentBridge }).execute();
    expect(seen[0]).toMatchObject({ cwd: '/repo', timeoutMs: 9000, permissionMode: 'acceptEdits' });
  });
});

describe('PlanExecutor — defaultCwd', () => {
  it('falls back to ctx.defaultCwd for bash and agent nodes, node cwd wins', async () => {
    const cwds: Array<string | undefined> = [];
    const shellRunner = async (_c: string, o: { cwd?: string }) => {
      cwds.push(o.cwd);
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    const agentBridge: AgentBridge = {
      async invoke(i): Promise<AgentResult> {
        cwds.push(i.cwd);
        return { output: {} };
      },
    };
    const def: PlanDefinition = {
      entrypoint: 'b1',
      nodes: [
        { id: 'b1', type: 'bash', label: 'b1', config: { command: 'x' }, edges: [{ target: 'b2' }] },
        { id: 'b2', type: 'bash', label: 'b2', config: { command: 'x', cwd: '/own' }, edges: [{ target: 'a1' }] },
        { id: 'a1', type: 'agent', label: 'a1', config: { prompt: 'p' }, edges: [] },
      ],
    };
    await new PlanExecutor('p', def, { shellRunner, agentBridge, defaultCwd: '/proj' }).execute();
    expect(cwds).toEqual(['/proj', '/own', '/proj']);
  });
});

describe('PlanExecutor — onStateChange (partial progress)', () => {
  it('fires on every node transition with the running state before the plan ends', async () => {
    const seen: Array<{ current?: string; status: string | undefined }> = [];
    const exec = new PlanExecutor('p-progress', mkDef(), {
      onStateChange: (s) =>
        seen.push({ current: s.currentNodeId, status: s.timeline[s.timeline.length - 1]?.status }),
    });
    const final = await exec.execute();

    expect(seen.map((x) => x.status)).toEqual(['running', 'done', 'running', 'done']);
    expect(seen[0]).toEqual({ current: 'a', status: 'running' });
    expect(final.state).toBe('completed');
  });

  it('records the failed transition so a crashed run is still observable', async () => {
    const statuses: string[] = [];
    const exec = new PlanExecutor(
      'p-fail',
      {
        entrypoint: 'x',
        nodes: [{ id: 'x', type: 'agent', label: 'X', config: {}, edges: [] }],
      },
      { onStateChange: (s) => statuses.push(s.timeline[s.timeline.length - 1].status) }
    );
    const final = await exec.execute();

    expect(final.state).toBe('failed');
    expect(statuses).toEqual(['running', 'failed']);
  });

  it('never lets a throwing persistence callback break the execution', async () => {
    const exec = new PlanExecutor('p-throw', mkDef(), {
      onStateChange: () => {
        throw new Error('db locked');
      },
    });
    const final = await exec.execute();
    expect(final.state).toBe('completed');
  });
});
