import type { TokenUsage } from '../../../shared/types/index.js';
import type { EnrichedTokenEventData } from '../../../shared/types/token-event.js';

const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

export function computeTokenTotals(evts: EnrichedTokenEventData[]): TokenUsage {
  return evts.reduce<TokenUsage>(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.usage.inputTokens,
      outputTokens: acc.outputTokens + e.usage.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + e.usage.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + e.usage.cacheCreationTokens,
    }),
    { ...ZERO },
  );
}
