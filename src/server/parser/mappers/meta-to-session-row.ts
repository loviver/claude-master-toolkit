import type { TokenUsage } from '../../../shared/types/index.js';
import type { SessionMeta } from '../types.js';

export function metaToSessionInsert(
  meta: SessionMeta,
  totals: TokenUsage,
  cost: number,
  filePath: string,
  projectPath: string,
) {
  return {
    id: meta.sessionId,
    projectPath,
    startedAt: new Date(meta.startedAt).getTime(),
    lastActiveAt: new Date(meta.lastActiveAt).getTime(),
    primaryModel: meta.primaryModel,
    gitBranch: meta.gitBranch,
    version: meta.version,
    turnCount: meta.turnCount,
    totalInputTokens: totals.inputTokens,
    totalOutputTokens: totals.outputTokens,
    totalCacheReadTokens: totals.cacheReadTokens,
    totalCacheCreationTokens: totals.cacheCreationTokens,
    totalCostUsd: cost,
    jsonlFile: filePath,
    customTitle: meta.customTitle,
    lastPrompt: meta.lastPrompt,
    entrypoint: meta.entrypoint,
  };
}

export function metaToSessionUpdate(meta: SessionMeta, totals: TokenUsage, cost: number) {
  return {
    lastActiveAt: new Date(meta.lastActiveAt).getTime(),
    primaryModel: meta.primaryModel,
    turnCount: meta.turnCount,
    totalInputTokens: totals.inputTokens,
    totalOutputTokens: totals.outputTokens,
    totalCacheReadTokens: totals.cacheReadTokens,
    totalCacheCreationTokens: totals.cacheCreationTokens,
    totalCostUsd: cost,
    customTitle: meta.customTitle,
    lastPrompt: meta.lastPrompt,
    entrypoint: meta.entrypoint,
  };
}
