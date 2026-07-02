import type { Node, Edge } from '@xyflow/react';
import type { PlanDefinition, PlanNode } from '../../../../shared/types/plan.js';
import type { WfNodeData } from '../nodes/WorkflowNodes.js';

export function planToFlow(def: PlanDefinition): { nodes: Node<WfNodeData>[]; edges: Edge[] } {
  // BFS from entrypoint to compute depth
  const depthMap = new Map<string, number>();
  const queue: string[] = [def.entrypoint];
  depthMap.set(def.entrypoint, 0);

  const nodeById = new Map<string, PlanNode>();
  for (const n of def.nodes) nodeById.set(n.id, n);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const planNode = nodeById.get(current);
    if (!planNode) continue;
    const depth = depthMap.get(current)!;
    for (const edge of planNode.edges) {
      if (!depthMap.has(edge.target)) {
        depthMap.set(edge.target, depth + 1);
        queue.push(edge.target);
      }
    }
  }

  // Nodes not reachable from entrypoint get depth = max + 1
  let maxDepth = 0;
  for (const d of depthMap.values()) if (d > maxDepth) maxDepth = d;
  for (const n of def.nodes) {
    if (!depthMap.has(n.id)) depthMap.set(n.id, maxDepth + 1);
  }

  // Group by depth for y-index
  const depthGroups = new Map<number, string[]>();
  for (const [id, depth] of depthMap.entries()) {
    if (!depthGroups.has(depth)) depthGroups.set(depth, []);
    depthGroups.get(depth)!.push(id);
  }

  const positionMap = new Map<string, { x: number; y: number }>();
  for (const [depth, ids] of depthGroups.entries()) {
    ids.forEach((id, idx) => {
      positionMap.set(id, { x: depth * 240, y: idx * 120 });
    });
  }

  const nodes: Node<WfNodeData>[] = def.nodes.map((planNode) => ({
    id: planNode.id,
    type: planNode.type,
    position: positionMap.get(planNode.id) ?? { x: 0, y: 0 },
    data: {
      label: planNode.label,
      description: planNode.description,
      status: undefined,
      isEntrypoint: planNode.id === def.entrypoint,
      config: planNode.config,
    },
  }));

  const edges: Edge[] = [];
  for (const planNode of def.nodes) {
    for (const e of planNode.edges) {
      edges.push({
        id: `e-${planNode.id}-${e.target}`,
        source: planNode.id,
        target: e.target,
        animated: false,
      });
    }
  }

  return { nodes, edges };
}

export function flowToPlan(
  nodes: Node<WfNodeData>[],
  edges: Edge[],
  entrypoint: string,
): PlanDefinition {
  // Group edges by source
  const edgesBySource = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (!edgesBySource.has(edge.source)) edgesBySource.set(edge.source, []);
    edgesBySource.get(edge.source)!.push(edge);
  }

  const planNodes: PlanNode[] = nodes.map((node) => ({
    id: node.id,
    type: (node.type ?? 'task') as PlanNode['type'],
    label: node.data.label,
    description: node.data.description,
    config: (node.data.config ?? {}) as Record<string, unknown>,
    edges: (edgesBySource.get(node.id) ?? []).map((e) => ({ target: e.target })),
  }));

  return { nodes: planNodes, entrypoint };
}
