import type { HookHandler } from '../runtime/types.js';

const APPLY_LIKE = new Set(['sdd-apply', 'general-purpose', 'cavecrew-builder']);

export const subagentStopHandler: HookHandler = (e) => {
  if (process.env['CTK_HOOK_SUBAGENT_NAG'] !== '1') return { kind: 'noop' };
  if (!e.agentType || !APPLY_LIKE.has(e.agentType)) return { kind: 'noop' };
  return {
    kind: 'context',
    text: `Sub-agent '${e.agentType}' finished. If it produced a decision, bugfix, convention, or non-obvious discovery, consolidate it now: mem_save (structured memory) or ctk_record (shared finding pool).`,
  };
};
