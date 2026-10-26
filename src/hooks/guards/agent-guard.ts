import type { HookEvent, HookResult } from '../runtime/types.js';

const TRUSTED = new Set(['Explore', 'Plan', 'claude-code-guide', 'statusline-setup', 'sdd-orchestrator']);

export interface AgentGuardDeps {
  /** CTK_HOOK_AGENT_STRICT=1 */
  strict: boolean;
}

/** Enforces the /delegate brief protocol. Must run on PreToolUse (needs to DENY before spawn). */
export function agentGuard(event: HookEvent, deps: AgentGuardDeps): HookResult {
  const sub = event.tool?.canonical === 'agent' ? event.tool.subagent : undefined;
  if (!sub) return { kind: 'noop' };
  if (sub.type && TRUSTED.has(sub.type)) return { kind: 'noop' };

  const hasBrief = /ctk_brief_read\(id=/.test(sub.prompt ?? '');
  const hasModel = !!sub.model;
  if (hasBrief && hasModel) return { kind: 'noop' };

  const reasons: string[] = [];
  if (!hasBrief) reasons.push('missing brief preamble (ctk_brief_read marker not found)');
  if (!hasModel) reasons.push('model param omitted');
  const reason = reasons.join('; ');

  if (deps.strict) {
    return {
      kind: 'block',
      reason: [
        `✗ Blocked Agent call: ${reason}.`,
        '',
        'Use /delegate <phase> <description> instead. It:',
        '  1. Creates a brief (ctk brief new <id> --task="...")',
        '  2. Resolves model (ctk model <phase>)',
        '  3. Checks context budget (ctk context)',
        '  4. Injects the mini-DSL preamble into the sub-agent prompt',
      ].join('\n'),
    };
  }
  return {
    kind: 'context',
    text: `Agent launched without /delegate protocol (${reason}). Next time prefer /delegate so the brief + model preamble is injected. Non-blocking.`,
  };
}
