import { planSelection } from './plan.js';
import { runPipeline, type Step } from '../pipeline/stages.js';
import { output, outputError } from '../../shared/output.js';

export interface OrchestrationPlan {
  steps: { id: string; addedDep: boolean }[];
}

export function buildOrchestrationPlan(selection: string): OrchestrationPlan {
  const resolved = planSelection(selection);
  const added = new Set(resolved.addedDependencies);
  return {
    steps: resolved.orderedComponents.map((id) => ({ id, addedDep: added.has(id) })),
  };
}

/**
 * For Phase 0.2 the orchestrator only *announces* the resolved component plan
 * through the pipeline runner. Component runners are wired in Phase 0.3+ once
 * the 10 sub-agents exist.
 */
export async function orchestrateCommand(selection: string): Promise<void> {
  try {
    const plan = buildOrchestrationPlan(selection);
    const steps: Step[] = plan.steps.map((s) => ({
      id: () => s.id,
      run: async () => {
        output(`[orchestrate] ${s.id}${s.addedDep ? ' (dep)' : ''} — (no-op, pending sub-agent wiring)`);
      },
    }));
    const r = await runPipeline({
      prepare: [],
      apply: steps,
      onProgress: (e) => output(`  · ${e.stepId} ${e.stage} ${e.status}`),
    });
    if (r.status === 'failed') {
      outputError(`orchestrate failed at step ${r.failedStep}: ${r.err?.message}`);
      process.exit(1);
    }
  } catch (err) {
    outputError(`ctk orchestrate failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
