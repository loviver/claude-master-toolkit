import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/db.js';
import { plans, planExecutions, planNodeStates } from '../db/schema.js';
import type { Plan, PlanExecutionState, PlanNodeState } from '../types/plan.js';

export function createPlan(plan: Omit<Plan, 'createdAt' | 'updatedAt'>): Plan {
  const db = getDb();
  const now = Date.now();
  const row = db
    .insert(plans)
    .values({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      definition: JSON.stringify(plan.definition),
      version: plan.version,
      projectPath: plan.projectPath,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return _mapPlan(row);
}

export function getPlan(planId: string): Plan | null {
  const db = getDb();
  const row = db.select().from(plans).where(eq(plans.id, planId)).get();
  return row ? _mapPlan(row) : null;
}

export function updatePlan(planId: string, updates: Partial<Plan>): Plan {
  const db = getDb();
  const row = db
    .update(plans)
    .set({
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.definition !== undefined && { definition: JSON.stringify(updates.definition) }),
      ...(updates.version !== undefined && { version: updates.version }),
      updatedAt: Date.now(),
    })
    .where(eq(plans.id, planId))
    .returning()
    .get();

  return _mapPlan(row);
}

export function listPlans(projectPath?: string): Plan[] {
  const db = getDb();
  const rows = projectPath
    ? db.select().from(plans).where(eq(plans.projectPath, projectPath)).all()
    : db.select().from(plans).all();
  return rows.map(_mapPlan);
}

export function deletePlan(planId: string): void {
  const db = getDb();
  db.delete(plans).where(eq(plans.id, planId)).run();
}

// ── Executions ──

export function createExecution(planId: string, executionId: string): void {
  const db = getDb();
  db.insert(planExecutions)
    .values({
      id: executionId,
      planId,
      state: 'pending',
      startedAt: Date.now(),
    })
    .run();
}

export function getExecution(executionId: string): PlanExecutionState | null {
  const db = getDb();
  const exec = db
    .select()
    .from(planExecutions)
    .where(eq(planExecutions.id, executionId))
    .get();

  if (!exec) return null;

  const nodeRows = db
    .select()
    .from(planNodeStates)
    .where(eq(planNodeStates.executionId, executionId))
    .all();

  const nodeStateMap = new Map<string, PlanNodeState>();
  for (const ns of nodeRows) {
    nodeStateMap.set(ns.nodeId, {
      nodeId: ns.nodeId,
      status: ns.status as PlanNodeState['status'],
      output: ns.output ? JSON.parse(ns.output) : undefined,
      error: ns.error ?? undefined,
      attempts: ns.attempts,
      startedAt: ns.startedAt ?? undefined,
      completedAt: ns.completedAt ?? undefined,
    });
  }

  return {
    id: exec.id,
    planId: exec.planId,
    state: exec.state as PlanExecutionState['state'],
    currentNodeId: exec.currentNodeId ?? undefined,
    nodeStates: nodeStateMap,
    output: exec.output ? JSON.parse(exec.output) : undefined,
    error: exec.error ?? undefined,
    startedAt: exec.startedAt,
    completedAt: exec.completedAt ?? undefined,
    timeline: exec.timeline ? JSON.parse(exec.timeline) : [],
  };
}

export function updateExecution(executionId: string, state: PlanExecutionState): void {
  const db = getDb();

  db.update(planExecutions)
    .set({
      state: state.state,
      currentNodeId: state.currentNodeId ?? null,
      output: state.output ? JSON.stringify(state.output) : null,
      error: state.error ?? null,
      completedAt: state.completedAt ?? null,
      timeline: JSON.stringify(state.timeline),
    })
    .where(eq(planExecutions.id, executionId))
    .run();

  for (const [nodeId, nodeState] of state.nodeStates) {
    const existing = db
      .select()
      .from(planNodeStates)
      .where(
        and(
          eq(planNodeStates.executionId, executionId),
          eq(planNodeStates.nodeId, nodeId)
        )
      )
      .get();

    const values = {
      status: nodeState.status,
      output: nodeState.output ? JSON.stringify(nodeState.output) : null,
      error: nodeState.error ?? null,
      attempts: nodeState.attempts,
      startedAt: nodeState.startedAt ?? null,
      completedAt: nodeState.completedAt ?? null,
    };

    if (existing) {
      db.update(planNodeStates)
        .set(values)
        .where(
          and(
            eq(planNodeStates.executionId, executionId),
            eq(planNodeStates.nodeId, nodeId)
          )
        )
        .run();
    } else {
      db.insert(planNodeStates)
        .values({ executionId, nodeId, ...values })
        .run();
    }
  }
}

// ── Helpers ──

function _mapPlan(row: typeof plans.$inferSelect): Plan {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    definition: JSON.parse(row.definition),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    projectPath: row.projectPath ?? undefined,
  };
}
