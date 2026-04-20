import type { HookAttachment } from '../../../shared/types/dashboard.js';

export function hookToRow(
  hook: HookAttachment,
  sessionId: string,
  uuidToEventId: Map<string, number>,
) {
  const eventId = hook.parentUuid ? (uuidToEventId.get(hook.parentUuid) ?? null) : null;
  return {
    sessionId,
    eventId,
    hookName: hook.hookName,
    hookEvent: hook.hookEvent,
    exitCode: hook.exitCode ?? null,
    durationMs: hook.durationMs ?? null,
    stdout: hook.stdout ?? null,
    stderr: hook.stderr ?? null,
    command: hook.command ?? null,
    timestamp: new Date(hook.timestamp).getTime(),
  };
}
