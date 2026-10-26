import type { HookEvent, HookHandler, HookResult } from '../runtime/types.js';
import { bashGuard } from '../guards/bash-guard.js';
import { agentGuard } from '../guards/agent-guard.js';
import { editGuard } from '../guards/edit-guard.js';
import { loadSkillGlobs } from '../lib/skills.js';
import { writtenFiles } from '../lib/shell-writes.js';

const skillHints = (e: HookEvent, filePaths: string[]): HookResult => {
  if (process.env['CTK_HOOK_EDIT_SKILL_INJECT'] === '0' || filePaths.length === 0) return { kind: 'noop' };
  return editGuard({ ...e, tool: { ...e.tool!, filePaths } }, { skills: loadSkillGlobs(e.cwd) });
};

export const preToolUseHandler: HookHandler = (e) => {
  switch (e.tool?.canonical) {
    case 'shell': {
      const blocked = bashGuard(e);
      if (blocked.kind === 'block') return blocked;
      // Codex edits files through Bash, so a shell write gets the same skill hint an Edit would.
      return skillHints(e, writtenFiles(e.tool, e.cwd));
    }
    case 'agent':
      return agentGuard(e, { strict: process.env['CTK_HOOK_AGENT_STRICT'] === '1' });
    case 'edit':
    case 'write':
      return skillHints(e, e.tool.filePaths ?? []);
    default:
      return { kind: 'noop' };
  }
};
