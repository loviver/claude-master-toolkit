// ── Primitive token tracking ──

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// ── CLI output wrapper ──

export interface CliOutput<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
