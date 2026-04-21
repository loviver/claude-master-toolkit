import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { createPlan, getPlan, listPlans, deletePlan, createExecution, getExecution, updateExecution } from '../../shared/plans/crud.js';
import { PlanExecutor } from '../../shared/plans/executor.js';
import { output, outputError } from '../../shared/output.js';
import type { Plan, PlanDefinition } from '../../shared/types/plan.js';

export function planCreateCommand(name: string, jsonFile: string, opts: any): void {
  try {
    const def = JSON.parse(readFileSync(jsonFile, 'utf-8')) as PlanDefinition;
    const plan = createPlan({
      id: randomUUID(),
      name,
      definition: def,
      version: 1,
      projectPath: opts.projectPath ?? process.cwd(),
    });
    output({ created: true, id: plan.id, name: plan.name });
  } catch (err) {
    outputError(`plan create failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

export function planListCommand(opts: any): void {
  try {
    const list = listPlans(opts.projectPath ?? process.cwd());
    output({
      count: list.length,
      plans: list.map((p) => ({
        id: p.id,
        name: p.name,
        version: p.version,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    outputError(`plan list failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

export function planGetCommand(planId: string): void {
  try {
    const plan = getPlan(planId);
    if (!plan) {
      outputError(`plan not found: ${planId}`);
      process.exit(1);
    }
    output({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      definition: plan.definition,
      version: plan.version,
    });
  } catch (err) {
    outputError(`plan get failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

export function planDeleteCommand(planId: string): void {
  try {
    const plan = getPlan(planId);
    if (!plan) {
      outputError(`plan not found: ${planId}`);
      process.exit(1);
    }
    deletePlan(planId);
    output({ deleted: true, id: planId });
  } catch (err) {
    outputError(`plan delete failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

export async function planExecCommand(planId: string): Promise<void> {
  try {
    const plan = getPlan(planId);
    if (!plan) {
      outputError(`plan not found: ${planId}`);
      process.exit(1);
    }

    const execId = randomUUID();
    createExecution(planId, execId);

    const executor = new PlanExecutor(planId, plan.definition, {
      onProgress: (msg) => output(`  ${msg}`),
      onError: (nodeId, err) => outputError(`  Node ${nodeId}: ${err.message}`),
    });

    output(`Executing plan: ${plan.name}`);
    const finalState = await executor.execute();
    updateExecution(execId, finalState);

    if (finalState.state === 'completed') {
      output(`✓ Execution completed`);
      output({
        executionId: execId,
        state: finalState.state,
        timeline: finalState.timeline,
      });
      process.exit(0);
    } else {
      outputError(`Execution failed: ${finalState.error}`);
      process.exit(1);
    }
  } catch (err) {
    outputError(`plan exec failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

export function planStatusCommand(executionId: string): void {
  try {
    const exec = getExecution(executionId);
    if (!exec) {
      outputError(`execution not found: ${executionId}`);
      process.exit(1);
    }
    output({
      id: exec.id,
      planId: exec.planId,
      state: exec.state,
      currentNodeId: exec.currentNodeId,
      timeline: exec.timeline,
      nodeStates: Array.from(exec.nodeStates.entries()).map(([id, state]) => ({
        nodeId: id,
        ...state,
      })),
    });
  } catch (err) {
    outputError(`plan status failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
