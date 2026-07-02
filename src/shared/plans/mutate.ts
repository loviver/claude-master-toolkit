import type {
  MutationOp,
  PlanDefinition,
  PlanNode,
} from '../types/plan.js';

export class MutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutationError';
  }
}

export function applyMutation(def: PlanDefinition, op: MutationOp): PlanDefinition {
  const nodes = def.nodes.map((n) => ({ ...n, edges: n.edges.map((e) => ({ ...e })) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  switch (op.op) {
    case 'addNode': {
      if (byId.has(op.node.id)) {
        throw new MutationError(`node ${op.node.id} already exists`);
      }
      const anchor = byId.get(op.after);
      if (!anchor) throw new MutationError(`anchor node ${op.after} not found`);

      // new node takes over anchor's outgoing edges; anchor points only to new node
      const newNode: PlanNode = {
        ...op.node,
        edges: op.node.edges.length > 0 ? op.node.edges : anchor.edges.map((e) => ({ ...e })),
      };
      anchor.edges = [{ target: newNode.id }];
      nodes.push(newNode);
      break;
    }

    case 'updateNode': {
      const target = byId.get(op.id);
      if (!target) throw new MutationError(`node ${op.id} not found`);
      Object.assign(target, op.patch);
      break;
    }

    case 'redirectEdge': {
      const source = byId.get(op.from);
      if (!source) throw new MutationError(`node ${op.from} not found`);
      const edge = source.edges.find((e) => e.target === op.to);
      if (!edge) throw new MutationError(`edge ${op.from}->${op.to} not found`);
      if (!byId.has(op.newTarget)) {
        throw new MutationError(`new target ${op.newTarget} not found`);
      }
      edge.target = op.newTarget;
      break;
    }

    case 'removeNode': {
      const target = byId.get(op.id);
      if (!target) throw new MutationError(`node ${op.id} not found`);
      if (op.id === def.entrypoint) {
        throw new MutationError('cannot remove entrypoint node');
      }

      if (op.mode === 'skip') {
        // rewire: every edge pointing at `id` now points at id's first successor
        const successor = target.edges[0]?.target;
        for (const n of nodes) {
          n.edges = n.edges
            .map((e) => (e.target === op.id ? (successor ? { ...e, target: successor } : null) : e))
            .filter((e): e is NonNullable<typeof e> => e !== null);
        }
      } else {
        // prune: drop edges pointing at `id`
        for (const n of nodes) {
          n.edges = n.edges.filter((e) => e.target !== op.id);
        }
      }
      const idx = nodes.findIndex((n) => n.id === op.id);
      if (idx >= 0) nodes.splice(idx, 1);
      break;
    }

    case 'addBranch': {
      const source = byId.get(op.from);
      if (!source) throw new MutationError(`node ${op.from} not found`);
      if (!byId.has(op.truePath) || !byId.has(op.falsePath)) {
        throw new MutationError('branch targets must exist');
      }
      source.edges.push(
        { target: op.truePath, condition: op.condition },
        { target: op.falsePath, condition: `!${op.condition}` },
      );
      break;
    }

    default: {
      const _exhaustive: never = op;
      throw new MutationError(`unknown op: ${JSON.stringify(_exhaustive)}`);
    }
  }

  const next = { nodes, entrypoint: def.entrypoint };
  assertAcyclic(next);
  return next;
}

export function assertAcyclic(def: PlanDefinition): void {
  const state = new Map<string, 'unvisited' | 'visiting' | 'done'>();
  for (const n of def.nodes) state.set(n.id, 'unvisited');
  const byId = new Map(def.nodes.map((n) => [n.id, n]));

  const visit = (id: string): void => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting') throw new MutationError(`cycle detected at node ${id}`);
    state.set(id, 'visiting');
    const node = byId.get(id);
    if (node) for (const e of node.edges) visit(e.target);
    state.set(id, 'done');
  };

  for (const n of def.nodes) visit(n.id);
}
