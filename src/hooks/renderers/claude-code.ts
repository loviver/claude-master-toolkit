import type { HookEventName, HookResult, RenderedOutput } from '../runtime/types.js';

const PLAIN_STDOUT: ReadonlySet<HookEventName> = new Set(['SessionStart', 'UserPromptSubmit']);

const json = (o: unknown) => JSON.stringify(o) + '\n';

/** HookResult[] (already combined) -> what Claude Code expects. */
export function renderClaude(event: HookEventName, results: HookResult[]): RenderedOutput {
  const out: RenderedOutput = { stdout: '', stderr: '', exitCode: 0 };

  for (const r of results) {
    switch (r.kind) {
      case 'noop':
        break;
      case 'block':
        out.stderr += r.reason + '\n';
        out.exitCode = 2;
        break;
      case 'ask':
        out.stdout += json({
          hookSpecificOutput: {
            hookEventName: event,
            permissionDecision: 'ask',
            permissionDecisionReason: r.reason,
          },
        });
        break;
      case 'context':
        if (PLAIN_STDOUT.has(event)) {
          out.stdout += r.text + '\n';
        } else if (event === 'PreToolUse') {
          out.stdout += json({
            hookSpecificOutput: { hookEventName: event, permissionDecision: 'allow', additionalContext: r.text },
          });
        } else {
          out.stdout += json({ hookSpecificOutput: { hookEventName: event, additionalContext: r.text } });
        }
        break;
      case 'message':
        if (event === 'Stop') out.stderr += r.text + '\n';
        else out.stdout += json({ systemMessage: r.text });
        break;
    }
  }
  return out;
}
