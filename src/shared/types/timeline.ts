// ── Daily timeline aggregation ──

export interface TimelinePoint {
  date: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  sessions: number;
}

// ── Per-model cost metrics ──

export interface ModelBreakdown {
  model: string;
  totalTokens: number;
  costUsd: number;
  sessionCount: number;
  percentage: number;
}
