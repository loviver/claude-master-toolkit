import type { HookEventName, HookResult, RenderedOutput } from '../runtime/types.js';

/**
 * Output contract per the official Codex hooks doc:
 *  - plain stdout is developer context on SessionStart / UserPromptSubmit / SubagentStart;
 *    on PostToolUse it is ignored; on Stop it is INVALID (Stop wants JSON when exit 0)
 *  - PreToolUse: deny = exit 2 + stderr; `ask` is unsupported; `allow` only with updatedInput
 *    (so we never emit permissionDecision)
 *  - Stop: exit 2 + stderr (or decision:block) starts a continuation prompt with the reason
 *  - UserPromptSubmit blocks with {"decision":"block","reason"}
 *  - PreCompact: no additionalContext (only systemMessage and the common fields)
 */
const PLAIN_STDOUT: ReadonlySet<HookEventName> = new Set(['SessionStart', 'UserPromptSubmit', 'SubagentStart']);
const TOOL_CONTEXT: ReadonlySet<HookEventName> = new Set(['PreToolUse', 'PostToolUse']);

export function renderCodex(event: HookEventName, results: HookResult[]): RenderedOutput {
  const out: RenderedOutput = { stdout: '', stderr: '', exitCode: 0 };

  const block = results.find((r) => r.kind === 'block');
  if (block && block.kind === 'block') {
    if (event === 'UserPromptSubmit') {
      out.stdout = JSON.stringify({ decision: 'block', reason: block.reason }) + '\n';
    } else {
      out.stderr = block.reason + '\n';
      out.exitCode = 2;
    }
    return out;
  }

  const contexts: string[] = [];
  const messages: string[] = [];
  for (const r of results) {
    if (r.kind === 'context') contexts.push(r.text);
    else if (r.kind === 'message') messages.push(r.text);
    // `ask` has no Codex equivalent: surface it as non-blocking context instead of a failed hook.
    else if (r.kind === 'ask') contexts.push(`[ctk] confirmation suggested: ${r.reason}`);
  }
  if (!contexts.length && !messages.length) return out;

  if (PLAIN_STDOUT.has(event)) {
    out.stdout = [...contexts, ...messages].join('\n') + '\n';
    return out;
  }

  const obj: Record<string, unknown> = {};
  if (TOOL_CONTEXT.has(event)) {
    if (contexts.length) {
      obj['hookSpecificOutput'] = { hookEventName: event, additionalContext: contexts.join('\n\n') };
    }
    if (messages.length) obj['systemMessage'] = messages.join('\n\n');
  } else if (event === 'Stop') {
    obj['systemMessage'] = [...contexts, ...messages].join('\n\n');
  } else if (messages.length) {
    obj['systemMessage'] = messages.join('\n\n'); // PreCompact & co: context is unsupported, message is not
  }
  if (Object.keys(obj).length) out.stdout = JSON.stringify(obj) + '\n';
  return out;
}
