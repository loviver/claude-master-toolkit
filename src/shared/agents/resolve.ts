import { homedir } from 'os';
import { getAdapter } from './index.js';
import type { AgentId } from './interface.js';

const IDS: readonly AgentId[] = ['claude-code', 'opencode', 'cursor', 'codex'];

function sniffAgent(): AgentId | null {
  const e = process.env;
  if (e['CODEX_MANAGED_BY_NPM'] || e['CODEX_MANAGED_PACKAGE_ROOT'] || e['CODEX_THREAD_ID'] || e['CODEX_HOME']) return 'codex';
  if (e['CLAUDECODE'] || e['CLAUDE_SESSION_ID']) return 'claude-code';
  return null;
}

/** Precedence: explicit flag > CTK_AGENT > env sniffing > claude-code. */
export function resolveAgentId(flag?: string): AgentId {
  const raw = flag ?? process.env['CTK_AGENT'];
  if (raw) {
    if (!IDS.includes(raw as AgentId)) throw new Error(`Unknown agent: ${raw}`);
    return raw as AgentId;
  }
  return sniffAgent() ?? 'claude-code';
}

/**
 * Session id for the current process. Codex ids are prefixed `codex:` so they
 * never collide with Claude ids in the shared DB.
 */
export function currentSessionId(agent?: AgentId): string | undefined {
  const explicit = process.env['CTK_SESSION_ID'];
  if (explicit) return explicit;
  const id = agent ?? sniffAgent() ?? 'claude-code';
  const envName = getAdapter(id).sessionIdEnv();
  const v = envName ? process.env[envName] : undefined;
  if (!v) return undefined;
  return id === 'codex' ? `codex:${v}` : v;
}

/** Main-thread model for the resolved agent; one default for every caller. */
export function readMainModel(agent?: AgentId): string {
  return getAdapter(agent ?? resolveAgentId()).readMainModel(homedir()) ?? 'sonnet';
}
