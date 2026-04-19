import { readFile } from 'fs/promises';
import { basename } from 'path';
import type { SessionEvent, TokenUsage } from '../types/index.js';

// ── Raw JSONL parsing ──

/**
 * Parse a JSONL file into SessionEvent array.
 * Resilient: skips malformed lines.
 */
export async function parseJsonlFile(filePath: string): Promise<SessionEvent[]> {
  const content = await readFile(filePath, 'utf-8');
  const events: SessionEvent[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as SessionEvent);
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

// ── Token event extraction ──

/**
 * Extract token usage events from parsed session events.
 * Returns one entry per assistant turn that has usage data.
 */
export function extractTokenEvents(events: SessionEvent[]): Array<{
  timestamp: string;
  model: string;
  usage: TokenUsage;
}> {
  return events
    .filter(
      (e): e is SessionEvent & { type: 'assistant' } =>
        e.type === 'assistant' && !!(e as { message?: { usage?: unknown } }).message?.usage,
    )
    .map((e) => {
      const msg = e.message;
      return {
        timestamp: e.timestamp,
        model: msg.model ?? 'unknown',
        usage: {
          inputTokens: msg.usage!.input_tokens ?? 0,
          outputTokens: msg.usage!.output_tokens ?? 0,
          cacheReadTokens: msg.usage!.cache_read_input_tokens ?? 0,
          cacheCreationTokens: msg.usage!.cache_creation_input_tokens ?? 0,
        },
      };
    });
}

// ── Cumulative token usage ──

export async function getSessionTokens(filePath: string): Promise<TokenUsage> {
  const events = await parseJsonlFile(filePath);
  const tokenEvents = extractTokenEvents(events);

  return tokenEvents.reduce<TokenUsage>(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.usage.inputTokens,
      outputTokens: acc.outputTokens + e.usage.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + e.usage.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + e.usage.cacheCreationTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );
}

// ── Latest turn usage (current context window) ──

export async function getLatestTurnUsage(filePath: string): Promise<TokenUsage> {
  const events = await parseJsonlFile(filePath);
  const tokenEvents = extractTokenEvents(events);
  const last = tokenEvents.at(-1);

  if (!last) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  }

  return last.usage;
}

// ── Session metadata ──

export function extractSessionMeta(events: SessionEvent[]): {
  sessionId: string;
  startedAt: string;
  lastActiveAt: string;
  cwd: string;
  gitBranch?: string;
  version?: string;
  primaryModel: string;
  turnCount: number;
} {
  const first = events[0];

  const modelCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'assistant' && e.message?.model) {
      const m = e.message.model;
      modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1);
    }
  }
  const primaryModel = [...modelCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  const turnCount = events.filter((e) => e.type === 'assistant').length;

  // JSONL lines are not guaranteed chronological (resumed sessions).
  let minTs: string | undefined;
  let maxTs: string | undefined;
  for (const e of events) {
    if (!e.timestamp) continue;
    if (minTs === undefined || e.timestamp < minTs) minTs = e.timestamp;
    if (maxTs === undefined || e.timestamp > maxTs) maxTs = e.timestamp;
  }
  const fallback = new Date().toISOString();

  return {
    sessionId: first?.sessionId ?? basename(first?.uuid ?? 'unknown'),
    startedAt: minTs ?? fallback,
    lastActiveAt: maxTs ?? minTs ?? fallback,
    cwd: first?.cwd ?? '',
    gitBranch: first?.gitBranch,
    version: first?.version,
    primaryModel,
    turnCount,
  };
}
