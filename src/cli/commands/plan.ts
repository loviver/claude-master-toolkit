import { Resolver, type ResolvedPlan } from '../planner/graph.js';
import { buildCtkGraph, CTK_COMPONENTS } from '../planner/ctk-graph.js';
import { output, outputError, isJsonMode } from '../../shared/output.js';

export function planSelection(input: string): ResolvedPlan {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('selection is empty');
  const selection = trimmed === 'all'
    ? [...CTK_COMPONENTS]
    : trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  const resolver = new Resolver(buildCtkGraph());
  return resolver.resolve(selection);
}

export function planCommand(selection: string): void {
  try {
    const r = planSelection(selection);
    if (isJsonMode()) {
      output(JSON.stringify(r, null, 2));
      return;
    }
    output(`Resolved plan (${r.orderedComponents.length} components):`);
    r.orderedComponents.forEach((id, i) => {
      const flag = r.addedDependencies.includes(id) ? ' (+dep)' : '';
      output(`  ${i + 1}. ${id}${flag}`);
    });
  } catch (err) {
    outputError(`ctk plan failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
