import { describe, it, expect } from 'vitest';
import { planToFlow, flowToPlan } from './planToFlow.js';
import type { PlanDefinition } from '../../../../shared/types/plan.js';

const simpleDef: PlanDefinition = {
  entrypoint: 'a',
  nodes: [
    { id: 'a', type: 'task', label: 'Node A', description: 'desc a', config: {}, edges: [{ target: 'b' }] },
    { id: 'b', type: 'agent', label: 'Node B', config: {}, edges: [] },
  ],
};

const threeNodeDef: PlanDefinition = {
  entrypoint: 'start',
  nodes: [
    { id: 'start', type: 'task', label: 'Start', config: {}, edges: [{ target: 'middle' }, { target: 'end' }] },
    { id: 'middle', type: 'decision', label: 'Middle', config: {}, edges: [{ target: 'end' }] },
    { id: 'end', type: 'agent', label: 'End', config: {}, edges: [] },
  ],
};

const singleDef: PlanDefinition = {
  entrypoint: 'only',
  nodes: [
    { id: 'only', type: 'task', label: 'Only Node', config: {}, edges: [] },
  ],
};

describe('planToFlow', () => {
  it('returns correct node and edge counts', () => {
    const { nodes, edges } = planToFlow(simpleDef);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });

  it('each edge in def becomes an RF Edge with correct id/source/target', () => {
    const { edges } = planToFlow(simpleDef);
    expect(edges[0]).toMatchObject({
      id: 'e-a-b',
      source: 'a',
      target: 'b',
    });
  });

  it('entrypoint node has data.isEntrypoint = true', () => {
    const { nodes } = planToFlow(simpleDef);
    const entry = nodes.find(n => n.id === 'a');
    expect(entry?.data.isEntrypoint).toBe(true);
    const other = nodes.find(n => n.id === 'b');
    expect(other?.data.isEntrypoint).toBeFalsy();
  });

  it('node data has correct label and description', () => {
    const { nodes } = planToFlow(simpleDef);
    const a = nodes.find(n => n.id === 'a')!;
    expect(a.data.label).toBe('Node A');
    expect(a.data.description).toBe('desc a');
    const b = nodes.find(n => n.id === 'b')!;
    expect(b.data.label).toBe('Node B');
    expect(b.data.description).toBeUndefined();
  });

  it('node type is set from planNode.type', () => {
    const { nodes } = planToFlow(simpleDef);
    const a = nodes.find(n => n.id === 'a')!;
    expect(a.type).toBe('task');
    const b = nodes.find(n => n.id === 'b')!;
    expect(b.type).toBe('agent');
  });

  it('edge animated = false', () => {
    const { edges } = planToFlow(simpleDef);
    expect(edges[0].animated).toBe(false);
  });

  it('three-node graph: correct edge count', () => {
    const { nodes, edges } = planToFlow(threeNodeDef);
    expect(nodes).toHaveLength(3);
    // start->middle, start->end, middle->end = 3 edges
    expect(edges).toHaveLength(3);
  });

  it('single node, no edges — works without error', () => {
    const { nodes, edges } = planToFlow(singleDef);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
    expect(nodes[0].data.isEntrypoint).toBe(true);
  });

  it('auto-layout: multi-node graph assigns non-zero positions for non-entrypoint nodes', () => {
    const { nodes } = planToFlow(simpleDef);
    const b = nodes.find(n => n.id === 'b')!;
    expect(b.position.x).toBeGreaterThan(0);
  });

  it('auto-layout: entrypoint node at x=0', () => {
    const { nodes } = planToFlow(simpleDef);
    const a = nodes.find(n => n.id === 'a')!;
    expect(a.position.x).toBe(0);
  });
});

describe('flowToPlan', () => {
  it('reconstructs PlanDefinition correctly from nodes and edges', () => {
    const { nodes, edges } = planToFlow(simpleDef);
    const result = flowToPlan(nodes, edges, simpleDef.entrypoint);
    expect(result.entrypoint).toBe('a');
    expect(result.nodes).toHaveLength(2);
    const nodeA = result.nodes.find(n => n.id === 'a')!;
    expect(nodeA.label).toBe('Node A');
    expect(nodeA.type).toBe('task');
    expect(nodeA.edges).toHaveLength(1);
    expect(nodeA.edges[0].target).toBe('b');
  });

  it('round-trip: flowToPlan(planToFlow(def)) approximates original def', () => {
    const { nodes, edges } = planToFlow(simpleDef);
    const result = flowToPlan(nodes, edges, simpleDef.entrypoint);
    expect(result.entrypoint).toBe(simpleDef.entrypoint);
    expect(result.nodes.map(n => n.id).sort()).toEqual(simpleDef.nodes.map(n => n.id).sort());
    // edges preserved
    const aNode = result.nodes.find(n => n.id === 'a')!;
    expect(aNode.edges.map(e => e.target)).toContain('b');
  });

  it('round-trip single node', () => {
    const { nodes, edges } = planToFlow(singleDef);
    const result = flowToPlan(nodes, edges, singleDef.entrypoint);
    expect(result.entrypoint).toBe('only');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].edges).toHaveLength(0);
  });

  it('preserves config on round-trip (agent node with agentPrompt)', () => {
    const defWithConfig: PlanDefinition = {
      entrypoint: 'a',
      nodes: [
        {
          id: 'a',
          type: 'agent',
          label: 'Explorer',
          config: { subagent_type: 'Explore', prompt: 'map repo', toolWhitelist: ['Read', 'Grep'] },
          edges: [],
        },
      ],
    };
    const { nodes, edges } = planToFlow(defWithConfig);
    const result = flowToPlan(nodes, edges, defWithConfig.entrypoint);
    const nodeA = result.nodes.find((n) => n.id === 'a')!;
    expect(nodeA.config).toEqual({
      subagent_type: 'Explore',
      prompt: 'map repo',
      toolWhitelist: ['Read', 'Grep'],
    });
  });

  it('preserves config for bash primitive', () => {
    const bashDef: PlanDefinition = {
      entrypoint: 'b',
      nodes: [
        {
          id: 'b',
          type: 'bash' as PlanDefinition['nodes'][0]['type'],
          label: 'Install deps',
          config: { command: 'npm ci', timeout: 60000 },
          edges: [],
        },
      ],
    };
    const { nodes, edges } = planToFlow(bashDef);
    const result = flowToPlan(nodes, edges, bashDef.entrypoint);
    expect(result.nodes[0].config).toEqual({ command: 'npm ci', timeout: 60000 });
  });
});
