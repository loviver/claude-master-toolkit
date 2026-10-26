import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { HookHandler, HookResult } from '../runtime/types.js';
import { taskGuard } from '../guards/task-guard.js';
import { contextBudgetGuard, contextPct } from '../guards/context-budget-guard.js';
import { lastTurnTokens } from '../lib/transcript.js';
import { contextLimit, eventModel } from '../lib/context.js';
import { addWarned, readWarned } from '../lib/state.js';
import { ctkOut, gitDirty } from '../lib/proc.js';

const PLAN_INTENT =
  /(diseñ[aá]|crea|genera|create|design|generate).*(plan|workflow)|(plan).*(diseñ[aá]|para|for)|^\/plan-designer/i;
const SDD_CMD = /^\/?sdd-(new|ff|continue|explore|propose|spec|design|tasks|apply|verify|archive|onboard)\b/;

export const userPromptSubmitHandler: HookHandler = (e): HookResult => {
  const prompt = e.prompt ?? '';

  const task = taskGuard(prompt, { gitDirty: /^\/task\s+\S/.test(prompt) ? gitDirty(e.cwd) : false });
  if (task.result.kind !== 'noop') {
    if (task.task) {
      mkdirSync(join(e.cwd, '.ctk'), { recursive: true });
      writeFileSync(join(e.cwd, '.ctk', 'current-task.txt'), task.task + '\n');
    }
    return task.result;
  }

  if (prompt && !prompt.startsWith('/plan-designer') && PLAN_INTENT.test(prompt)) {
    return {
      kind: 'context',
      text: '[ctk-skill-hint] load plan-designer — detected plan design intent. Invoke the plan-designer skill.',
    };
  }

  if (SDD_CMD.test(prompt) && !existsSync(join(e.cwd, '.ctk', 'init.marker'))) {
    return {
      kind: 'context',
      text: '⚠ ctk init required — .ctk/init.marker missing for this project. Run `ctk init` (or let sdd-orchestrator run sdd-init) before continuing.',
    };
  }

  const tokens = lastTurnTokens(e.transcriptPath);
  if (tokens <= 0) return { kind: 'noop' };
  const model = eventModel(e);
  const limit = contextLimit(model);
  const warned = readWarned(e);
  const cost = contextPct(tokens, limit) >= 70 ? ctkOut(['cost', '--quiet'], e.cwd) : undefined;
  const g = contextBudgetGuard({ tokens, limit, model, warned, cost });
  if (g.level) addWarned(e, g.level);
  return g.result;
};
