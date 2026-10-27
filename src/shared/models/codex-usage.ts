import type { TokenUsage } from '../types/index.js';

export interface CodexRawUsage {
  input_tokens: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens: number;
  /** Subset of output_tokens (verified: total_tokens = input + output). Not added again. */
  reasoning_output_tokens?: number;
}

/** Codex `input_tokens` INCLUDES cached tokens; ctk prices them separately. */
export function normalizeCodexUsage(u: CodexRawUsage): TokenUsage {
  const cached = u.cached_input_tokens ?? 0;
  return {
    inputTokens: Math.max(0, u.input_tokens - cached),
    outputTokens: u.output_tokens,
    cacheReadTokens: cached,
    cacheCreationTokens: u.cache_write_input_tokens ?? 0,
  };
}
