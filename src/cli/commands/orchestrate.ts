import { planSelection } from './plan.js';
import { runPipeline, type Step } from '../pipeline/stages.js';
import { output, outputError } from '../../shared/output.js';
import { assessRisk } from '../../shared/risk/index.js';
import type { RiskTier } from '../../shared/risk/types.js';

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
 * Advisory ODD gate for the orchestrator. A DIRECT change is small enough to do
 * inline — no reason to spin up the pipeline. GUARDED/DELEGATE runs the pipeline
 * (whose component runners are still stubs, wired in Phase 0.3+). Risk is a
 * SUGGESTION: if it can't be read (no git / no index), orchestration proceeds.
 */
function readTier(): RiskTier | null {
  try {
    return assessRisk().score.tier;
  } catch {
    return null;
  }
}

/**
 * For Phase 0.2 the orchestrator only *announces* the resolved component plan
 * through the pipeline runner. Component runners are wired in Phase 0.3+ once
 * the 10 sub-agents exist. The ODD risk tier now gates whether the pipeline
 * runs at all (DIRECT short-circuits to inline).
 */
export async function orchestrateCommand(selection: string): Promise<void> {
  try {
    const tier = readTier();
    if (tier) {
      output(`[orchestrate] ODD risk tier: ${tier}`);
      if (tier === 'DIRECT') {
        output('[orchestrate] DIRECT — do it inline; no orchestration needed.');
        return;
      }
    }

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
