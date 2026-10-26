import type { HookHandler } from '../runtime/types.js';
import { bashGuard } from '../guards/bash-guard.js';
import { agentGuard } from '../guards/agent-guard.js';
import { editGuard } from '../guards/edit-guard.js';
import { loadSkillGlobs } from '../lib/skills.js';

export const preToolUseHandler: HookHandler = (e) => {
  switch (e.tool?.canonical) {
    case 'shell':
      return bashGuard(e);
    case 'agent':
      return agentGuard(e, { strict: process.env['CTK_HOOK_AGENT_STRICT'] === '1' });
    case 'edit':
    case 'write':
      if (process.env['CTK_HOOK_EDIT_SKILL_INJECT'] === '0') return { kind: 'noop' };
      return editGuard(e, { skills: loadSkillGlobs(e.cwd) });
    default:
      return { kind: 'noop' };
  }
};
