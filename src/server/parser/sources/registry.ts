import { claudeSessionSource } from './claude.js';
import { codexSessionSource } from './codex.js';
import type { SessionSource } from './types.js';

/**
 * Every agent whose sessions ctk ingests. Order matters: `sourceFor` returns the
 * first owner, so sources with narrow `owns` rules go before broad ones
 * (Codex rollouts are `.jsonl` too, and Claude claims any `.jsonl`).
 */
export const sessionSources: readonly SessionSource[] = [codexSessionSource, claudeSessionSource];

export function sourceFor(filePath: string): SessionSource | undefined {
  return sessionSources.find((s) => s.owns(filePath));
}
