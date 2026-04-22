import type { PlanDefinition } from '../../../../shared/types/plan.js';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validatePlan(def: PlanDefinition): ValidationResult {
  const errors: string[] = [];

  if (!def.nodes || def.nodes.length === 0) {
    errors.push('Plan must have at least one node');
    return { ok: false, errors };
  }

  const ids = new Set<string>();
  for (const n of def.nodes) {
    if (ids.has(n.id)) errors.push(`Duplicate node id: ${n.id}`);
    ids.add(n.id);
  }

  if (!ids.has(def.entrypoint)) {
    errors.push(`entrypoint "${def.entrypoint}" not found in nodes`);
  }

  for (const n of def.nodes) {
    for (const e of n.edges ?? []) {
      if (!ids.has(e.target)) {
        errors.push(`Node "${n.id}" edge target "${e.target}" does not exist`);
      }
    }
  }

  // cycle detection (DFS with colors)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  def.nodes.forEach((n) => color.set(n.id, WHITE));

  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    const n = byId.get(id);
    for (const e of n?.edges ?? []) {
      const c = color.get(e.target);
      if (c === GRAY) return true;
      if (c === WHITE && visit(e.target)) return true;
    }
    color.set(id, BLACK);
    return false;
  };

  for (const n of def.nodes) {
    if (color.get(n.id) === WHITE && visit(n.id)) {
      errors.push('Plan contains a cycle');
      break;
    }
  }

  return { ok: errors.length === 0, errors };
}
