import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const DEFAULT_MAX_STEPS = 10;

export interface BudgetOpts {
  sessionId?: string;
  agentId: string;
  max?: number;
  stateRoot?: string;
}

function resolveMax(opts: BudgetOpts): number {
  if (typeof opts.max === 'number') return opts.max;
  const env = process.env.CTK_AGENT_MAX_STEPS;
  if (env && /^\d+$/.test(env)) return parseInt(env, 10);
  return DEFAULT_MAX_STEPS;
}

function counterFile(opts: BudgetOpts): string {
  const root = opts.stateRoot ?? join(homedir(), '.claude', 'state', 'claude-master-toolkit');
  const sid = opts.sessionId ?? process.env.CLAUDE_SESSION_ID ?? 'default';
  const dir = join(root, sid, 'agent-steps');
  mkdirSync(dir, { recursive: true });
  return join(dir, opts.agentId);
}

export function readSteps(opts: BudgetOpts): number {
  const f = counterFile(opts);
  if (!existsSync(f)) return 0;
  const raw = readFileSync(f, 'utf8').trim();
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

export function incrementStep(opts: BudgetOpts): { steps: number; max: number; exceeded: boolean } {
  const f = counterFile(opts);
  const next = readSteps(opts) + 1;
  writeFileSync(f, String(next));
  const max = resolveMax(opts);
  return { steps: next, max, exceeded: next > max };
}

export function resetSteps(opts: BudgetOpts): void {
  const f = counterFile(opts);
  rmSync(f, { force: true });
}

export function budgetStatus(opts: BudgetOpts): {
  steps: number;
  max: number;
  remaining: number;
  exceeded: boolean;
} {
  const steps = readSteps(opts);
  const max = resolveMax(opts);
  return { steps, max, remaining: Math.max(0, max - steps), exceeded: steps > max };
}
