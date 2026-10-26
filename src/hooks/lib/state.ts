import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { ctkHome, ctkPaths } from '../../shared/paths/ctk-home-paths.js';
import type { HookEvent } from '../runtime/types.js';

export const stateDir = (e: Pick<HookEvent, 'agent' | 'sessionId'>): string =>
  ctkPaths.hookState(e.agent, e.sessionId);

export function readWarned(e: HookEvent): string[] {
  try {
    return readFileSync(join(stateDir(e), 'warned'), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export function addWarned(e: HookEvent, level: string): void {
  const dir = stateDir(e);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'warned'), level + '\n');
}

export const hasNagged = (e: HookEvent): boolean => existsSync(join(stateDir(e), 'nagged'));

export function markNagged(e: HookEvent): void {
  const dir = stateDir(e);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'nagged'), '');
}

export function purgeSession(e: HookEvent): void {
  rmSync(stateDir(e), { recursive: true, force: true });
}

/** Removes per-session state dirs (any agent) untouched for more than `days`. */
export function purgeStale(days: number, now = Date.now()): void {
  const root = join(ctkHome(), 'hooks-state');
  if (!existsSync(root)) return;
  const cutoff = now - days * 86_400_000;
  for (const agent of readdirSync(root)) {
    const agentDir = join(root, agent);
    let sessions: string[];
    try {
      sessions = readdirSync(agentDir);
    } catch {
      continue;
    }
    for (const s of sessions) {
      const p = join(agentDir, s);
      try {
        if (statSync(p).mtimeMs < cutoff) rmSync(p, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
