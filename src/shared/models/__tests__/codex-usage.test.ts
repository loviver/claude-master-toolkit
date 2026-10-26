import { describe, it, expect } from 'vitest';
import { normalizeCodexUsage } from '../codex-usage.js';

describe('normalizeCodexUsage', () => {
  it('splits cached out of input (Codex input_tokens includes cached)', () => {
    expect(
      normalizeCodexUsage({ input_tokens: 13138, cached_input_tokens: 12800, output_tokens: 75, reasoning_output_tokens: 12 }),
    ).toEqual({ inputTokens: 338, outputTokens: 75, cacheReadTokens: 12800, cacheCreationTokens: 0 });
  });
  it('does not double count reasoning (it is a subset of output_tokens)', () => {
    const u = normalizeCodexUsage({ input_tokens: 10, cached_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 60 });
    expect(u.outputTokens).toBe(100);
  });
  it('maps cache_write_input_tokens and clamps negatives', () => {
    const u = normalizeCodexUsage({ input_tokens: 5, cached_input_tokens: 9, cache_write_input_tokens: 3, output_tokens: 1 });
    expect(u.inputTokens).toBe(0);
    expect(u.cacheCreationTokens).toBe(3);
  });
});
