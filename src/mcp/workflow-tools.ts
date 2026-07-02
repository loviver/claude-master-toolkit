import { randomUUID } from 'crypto';
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  createExecution,
  getExecution,
  updateExecution,
  appendMutationLog,
  getMutationLog,
} from '../shared/plans/crud.js';
import { PlanExecutor } from '../shared/plans/executor.js';
import { applyMutation, MutationError } from '../shared/plans/mutate.js';
import type { MutationOp, PlanDefinition } from '../shared/types/plan.js';

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

  wf_generate(args: {
    description: string;
    project_path?: string;
  }): McpContent {
    try {
      const startId = randomUUID();
      const analyzeId = randomUUID();
      const implementId = randomUUID();
      const reviewId = randomUUID();

      const def: PlanDefinition = {
        entrypoint: startId,
        nodes: [
          {
            id: startId,
            type: 'task',
            label: 'Start',
            description: 'Entry point',
            config: {},
            edges: [{ target: analyzeId }],
          },
          {
            id: analyzeId,
            type: 'agent',
            label: 'Analyze',
            description: `Analyze: ${args.description}`,
            config: {
              agentRole: 'explorer',
              agentPrompt: `You are an explorer agent. ${args.description}. Analyze the situation thoroughly and provide detailed findings.`,
            },
            edges: [{ target: implementId }],
          },
          {
            id: implementId,
            type: 'agent',
            label: 'Implement',
            description: 'Implement solution based on analysis',
            config: {
              agentRole: 'implementer',
              agentPrompt: 'You are an implementer agent. Based on the analysis, implement the necessary changes. Follow best practices and write clean, maintainable code.',
            },
            edges: [{ target: reviewId }],
          },
          {
            id: reviewId,
            type: 'agent',
            label: 'Review',
            description: 'Review and verify implementation',
            config: {
              agentRole: 'reviewer',
              agentPrompt: 'You are a reviewer agent. Review the implementation for quality, correctness, and adherence to standards.',
            },
            edges: [],
          },
        ],
      };

      const plan = createPlan({
        id: randomUUID(),
        name: `Generated: ${args.description.substring(0, 40)}${args.description.length > 40 ? '...' : ''}`,
        description: `Auto-generated plan for: ${args.description}`,
        definition: def,
        version: 1,
        projectPath: args.project_path,
      });

      return ok({
        id: plan.id,
        name: plan.name,
        nodes: plan.definition.nodes.length,
      });
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
        getLiveDefinition: () => {
          const live = getPlan(args.plan_id);
          return live ? live.definition : plan.definition;
        },
      });
      executor.setExecutionId(execId);

      // Fire-and-forget — caller polls wf_status
      executor.execute().then((state) => {
        updateExecution(execId, state);
      });

      return ok({ execution_id: execId, state: 'running', plan_id: args.plan_id });
    } catch (e) {
      return err(String(e));
    }
  },

  wf_mutate(args: {
    execution_id: string;
    op: MutationOp;
    by_node_id?: string;
  }): McpContent {
    try {
      const exec = getExecution(args.execution_id);
      if (!exec) return err(`Execution ${args.execution_id} not found`);
      // Mutation is allowed even if the execution already finished — the change
      // persists on the plan definition and is recorded in the mutation log for
      // audit / future runs.

      const plan = getPlan(exec.planId);
      if (!plan) return err(`Plan ${exec.planId} not found`);

      let nextDef: PlanDefinition;
      try {
        nextDef = applyMutation(plan.definition, args.op);
      } catch (e) {
        if (e instanceof MutationError) return err(e.message);
        throw e;
      }

      updatePlan(plan.id, { definition: nextDef, version: plan.version + 1 });
      appendMutationLog(args.execution_id, {
        at: Date.now(),
        byNodeId: args.by_node_id,
        op: args.op,
      });

      return ok({
        execution_id: args.execution_id,
        plan_id: plan.id,
        op: args.op.op,
        version: plan.version + 1,
        nodes: nextDef.nodes.length,
      });
    } catch (e) {
      return err(String(e));
    }
  },

  wf_mutation_log(args: { execution_id: string }): McpContent {
    try {
      const log = getMutationLog(args.execution_id);
      return ok({ execution_id: args.execution_id, count: log.length, entries: log });
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
