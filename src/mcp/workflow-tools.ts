import { randomUUID } from 'crypto';
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  createExecution,
  getExecution,
  updateExecution,
} from '../shared/plans/crud.js';
import { PlanExecutor } from '../shared/plans/executor.js';
import type { PlanDefinition } from '../shared/types/plan.js';

type McpContent = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function ok(data: unknown): McpContent {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string): McpContent {
  return { content: [{ type: 'text', text: JSON.stringify({ error: msg }) }], isError: true };
}

export const wfHandlers = {
  wf_create(args: {
    name: string;
    definition: PlanDefinition;
    description?: string;
    project_path?: string;
  }): McpContent {
    try {
      const plan = createPlan({
        id: randomUUID(),
        name: args.name,
        description: args.description,
        definition: args.definition,
        version: 1,
        projectPath: args.project_path,
      });
      return ok({ id: plan.id, name: plan.name, version: plan.version });
    } catch (e) {
      return err(String(e));
    }
  },

  wf_list(args: { project_path?: string }): McpContent {
    try {
      const plans = listPlans(args.project_path);
      return ok({
        count: plans.length,
        plans: plans.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          version: p.version,
          createdAt: p.createdAt,
        })),
      });
    } catch (e) {
      return err(String(e));
    }
  },

  wf_get(args: { plan_id: string }): McpContent {
    try {
      const plan = getPlan(args.plan_id);
      if (!plan) return err(`Plan ${args.plan_id} not found`);
      return ok(plan);
    } catch (e) {
      return err(String(e));
    }
  },

  wf_update(args: {
    plan_id: string;
    name?: string;
    description?: string;
    definition?: PlanDefinition;
  }): McpContent {
    try {
      const plan = getPlan(args.plan_id);
      if (!plan) return err(`Plan ${args.plan_id} not found`);
      const updated = updatePlan(args.plan_id, {
        name: args.name,
        description: args.description,
        definition: args.definition,
      });
      return ok({ id: updated.id, name: updated.name, version: updated.version });
    } catch (e) {
      return err(String(e));
    }
  },

  async wf_execute(args: { plan_id: string }): Promise<McpContent> {
    try {
      const plan = getPlan(args.plan_id);
      if (!plan) return err(`Plan ${args.plan_id} not found`);

      const execId = randomUUID();
      createExecution(args.plan_id, execId);

      const executor = new PlanExecutor(args.plan_id, plan.definition, {
        onProgress: (msg) => process.stderr.write(`  [wf] ${msg}\n`),
        onError: (nodeId, e) => process.stderr.write(`  [wf] ${nodeId}: ${e.message}\n`),
      });

      // Fire-and-forget — caller polls wf_status
      executor.execute().then((state) => {
        updateExecution(execId, state);
      });

      return ok({ execution_id: execId, state: 'running', plan_id: args.plan_id });
    } catch (e) {
      return err(String(e));
    }
  },

  wf_status(args: { execution_id: string }): McpContent {
    try {
      const exec = getExecution(args.execution_id);
      if (!exec) return err(`Execution ${args.execution_id} not found`);
      return ok({
        id: exec.id,
        plan_id: exec.planId,
        state: exec.state,
        current_node_id: exec.currentNodeId,
        timeline: exec.timeline,
        error: exec.error,
        node_states: Array.from(exec.nodeStates.entries()).map(([id, s]) => ({
          node_id: id,
          status: s.status,
          attempts: s.attempts,
          error: s.error,
        })),
      });
    } catch (e) {
      return err(String(e));
    }
  },
};
