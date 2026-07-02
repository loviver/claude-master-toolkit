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
