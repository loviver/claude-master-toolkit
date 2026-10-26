import type { HookResult } from '../runtime/types.js';

export interface TaskGuardDeps {
  gitDirty: boolean;
}

/** `/task <name>`: blocks on dirty git, otherwise asks the caller to persist the name. */
export function taskGuard(prompt: string, deps: TaskGuardDeps): { result: HookResult; task?: string } {
  const m = /^\/task\s+(.+)$/s.exec(prompt);
  const task = m?.[1]?.trim().slice(0, 200);
  if (!task) return { result: { kind: 'noop' } };

  if (deps.gitDirty) {
    return {
      result: {
        kind: 'block',
        reason: '\n❌ Task switch blocked: git dirty\n   Commit current work before /task\n',
      },
    };
  }
  return { result: { kind: 'context', text: `✓ Task: ${task}` }, task };
}
