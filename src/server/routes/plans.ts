import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
  createExecution,
  getExecution,
  updateExecution,
} from '../../shared/plans/crud.js';
import { PlanExecutor } from '../../shared/plans/executor.js';
import type { Plan, PlanDefinition } from '../../shared/types/plan.js';

export async function plansRoutes(fastify: FastifyInstance) {
  // POST /api/plans — Create plan
  fastify.post<{ Body: { name: string; definition: PlanDefinition; projectPath?: string } }>(
    '/plans',
    async (req, reply) => {
      const { name, definition, projectPath } = req.body;
      if (!name || !definition) {
        return reply.code(400).send({ error: 'name and definition required' });
      }
      try {
        const plan = createPlan({
          id: randomUUID(),
          name,
          definition,
          version: 1,
          projectPath,
        });
        return reply.code(201).send(plan);
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    }
  );

  // GET /api/plans — List plans
  fastify.get<{ Querystring: { projectPath?: string } }>(
    '/plans',
    async (req, reply) => {
      try {
        const plans = listPlans(req.query.projectPath);
        return reply.send({ count: plans.length, plans });
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    }
  );

  // GET /api/plans/:id — Get plan
  fastify.get<{ Params: { id: string } }>(
    '/plans/:id',
    async (req, reply) => {
      try {
        const plan = getPlan(req.params.id);
        if (!plan) {
          return reply.code(404).send({ error: 'Plan not found' });
        }
        return reply.send(plan);
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    }
  );

  // PUT /api/plans/:id — Update plan
  fastify.put<{ Params: { id: string }; Body: Partial<Plan> }>(
    '/plans/:id',
    async (req, reply) => {
      try {
        const existing = getPlan(req.params.id);
        if (!existing) {
          return reply.code(404).send({ error: 'Plan not found' });
        }
        const updated = updatePlan(req.params.id, req.body);
        return reply.send(updated);
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    }
  );

  // DELETE /api/plans/:id — Delete plan
  fastify.delete<{ Params: { id: string } }>(
    '/plans/:id',
    async (req, reply) => {
      try {
        const plan = getPlan(req.params.id);
        if (!plan) {
          return reply.code(404).send({ error: 'Plan not found' });
        }
        deletePlan(req.params.id);
        return reply.send({ deleted: true });
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    }
  );

  // POST /api/plans/:id/execute — Start execution
  fastify.post<{ Params: { id: string } }>(
    '/plans/:id/execute',
    async (req, reply) => {
      try {
        const plan = getPlan(req.params.id);
        if (!plan) {
          return reply.code(404).send({ error: 'Plan not found' });
        }
        const execId = randomUUID();
        createExecution(req.params.id, execId);

        // Run executor async (fire & forget for MVP)
        const executor = new PlanExecutor(req.params.id, plan.definition, {
          onProgress: console.log,
          onError: console.error,
        });

        executor.execute().then((state) => {
          updateExecution(execId, state);
        });

        return reply.code(202).send({
          executionId: execId,
          message: 'Execution started',
        });
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    }
  );

  // GET /api/plans/:id/executions/:execId — Get execution status
  fastify.get<{ Params: { id: string; execId: string } }>(
    '/plans/:id/executions/:execId',
    async (req, reply) => {
      try {
        const exec = getExecution(req.params.execId);
        if (!exec) {
          return reply.code(404).send({ error: 'Execution not found' });
        }
        if (exec.planId !== req.params.id) {
          return reply.code(403).send({ error: 'Plan ID mismatch' });
        }
        return reply.send(exec);
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    }
  );
}
