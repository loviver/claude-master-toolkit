import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { HookHandler } from '../runtime/types.js';

const read = (p: string): string | undefined => {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8').trim() || undefined : undefined;
  } catch {
    return undefined;
  }
};

/** Injects persona + skill registry into the SUB-AGENT's own context. */
export const subagentStartHandler: HookHandler = (e) => {
  const parts: string[] = [];
  if (process.env['CTK_HOOK_PERSONA_INJECT'] !== '0') {
    const persona = read(process.env['CTK_PERSONA_FILE'] ?? join(homedir(), '.claude', 'persona.md'));
    if (persona) parts.push(`[ctk-persona]\n${persona}`);
  }
  if (process.env['CTK_HOOK_REGISTRY_INJECT'] !== '0') {
    const registry = read(join(e.cwd, '.ctk', 'skill-registry.md'));
    if (registry) parts.push(`[ctk-skills] registry at .ctk/skill-registry.md\n${registry}`);
  }
  return parts.length ? { kind: 'context', text: parts.join('\n\n') + '\n' } : { kind: 'noop' };
};
