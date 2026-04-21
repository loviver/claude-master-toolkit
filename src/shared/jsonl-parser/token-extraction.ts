import { readFile } from "fs/promises";
import { basename } from "path";
import type { SessionEvent, TokenUsage } from "../types/index.js";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const EMPTY_TOKENS: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

// ─────────────────────────────────────────────
// File parsing
// ─────────────────────────────────────────────

export async function parseJsonlFile(
  filePath: string,
): Promise<SessionEvent[]> {
  const content = await readFile(filePath, "utf-8");

  const events: SessionEvent[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line);
      events.push(parsed as SessionEvent);
    } catch {
      // ignore malformed line
    }
  }

  return events;
}

// ─────────────────────────────────────────────
// Type-safe access helpers (NO inline types in logic)
// ─────────────────────────────────────────────

function getAssistantMessage(event: SessionEvent) {
  if (event.type !== "assistant") return null;
  return event.message ?? null;
}

function hasUsage(event: SessionEvent): boolean {
  if (event.type !== "assistant") return false;
  return !!event.message?.usage;
}

function extractUsage(event: SessionEvent): TokenUsage {
  const msg = (event as any).message;

  return {
    inputTokens: msg?.usage?.input_tokens ?? 0,
    outputTokens: msg?.usage?.output_tokens ?? 0,
    cacheReadTokens: msg?.usage?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: msg?.usage?.cache_creation_input_tokens ?? 0,
  };
}

// ─────────────────────────────────────────────
// Token extraction
// ─────────────────────────────────────────────

export function extractTokenEvents(events: SessionEvent[]): Array<{
  timestamp: string;
  model: string;
  usage: TokenUsage;
}> {
  const result: Array<{
    timestamp: string;
    model: string;
    usage: TokenUsage;
  }> = [];

  for (const event of events) {
    if (!hasUsage(event)) continue;

    const msg = getAssistantMessage(event);
    if (!msg) continue;

    result.push({
      timestamp: event.timestamp,
      model: msg.model ?? "unknown",
      usage: extractUsage(event),
    });
  }

  return result;
}

// ─────────────────────────────────────────────
// Token aggregation
// ─────────────────────────────────────────────

export async function getSessionTokens(filePath: string): Promise<TokenUsage> {
  const events = await parseJsonlFile(filePath);
  const tokenEvents = extractTokenEvents(events);

  return tokenEvents.reduce<TokenUsage>((acc, e) => {
    return {
      inputTokens: acc.inputTokens + e.usage.inputTokens,
      outputTokens: acc.outputTokens + e.usage.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + e.usage.cacheReadTokens,
      cacheCreationTokens:
        acc.cacheCreationTokens + e.usage.cacheCreationTokens,
    };
  }, EMPTY_TOKENS);
}

// ─────────────────────────────────────────────
// Latest usage
// ─────────────────────────────────────────────

export async function getLatestTurnUsage(
  filePath: string,
): Promise<TokenUsage> {
  const events = await parseJsonlFile(filePath);
  const tokenEvents = extractTokenEvents(events);

  const last = tokenEvents[tokenEvents.length - 1];
  return last?.usage ?? EMPTY_TOKENS;
}

// ─────────────────────────────────────────────
// Metadata extraction helpers
// ─────────────────────────────────────────────

function getTextFromMessageContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    let out = "";

    for (const block of content) {
      if (block && typeof block === "object") {
        const typed = block as { type?: string; text?: string };
        if (typed.type === "text" && typeof typed.text === "string") {
          out += typed.text + "\n";
        }
      }
    }

    return out.trim() || undefined;
  }

  return undefined;
}

// ─────────────────────────────────────────────
// Session metadata
// ─────────────────────────────────────────────

export function extractSessionMeta(events: SessionEvent[]) {
  const first = events[0];

  const modelCounts = new Map<string, number>();

  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let version: string | undefined;

  let minTs: string | undefined;
  let maxTs: string | undefined;

  let customTitle: string | undefined;
  let lastPrompt: string | undefined;

  for (const e of events) {
    // timestamps
    if (e.timestamp) {
      if (!minTs || e.timestamp < minTs) minTs = e.timestamp;
      if (!maxTs || e.timestamp > maxTs) maxTs = e.timestamp;
    }

    // model count
    if (e.type === "assistant" && e.message?.model) {
      const m = e.message.model;
      modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1);
    }

    // cwd / git / version
    const anyEvent = e as any;

    if (!cwd && typeof anyEvent.cwd === "string") cwd = anyEvent.cwd;
    if (!gitBranch && typeof anyEvent.gitBranch === "string")
      gitBranch = anyEvent.gitBranch;
    if (!version && typeof anyEvent.version === "string")
      version = anyEvent.version;

    // title
    if (!customTitle) {
      if (typeof anyEvent.customTitle === "string") {
        customTitle = anyEvent.customTitle;
      } else if (
        anyEvent.type === "summary" &&
        typeof anyEvent.summary === "string"
      ) {
        customTitle = anyEvent.summary;
      }
    }

    // last prompt
    if (anyEvent.type === "user" && anyEvent.message?.content) {
      const text = getTextFromMessageContent(anyEvent.message.content);
      if (text) lastPrompt = text;
    }
  }

  const primaryModel =
    [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";

  const turnCount = events.reduce((acc, e) => {
    return acc + (e.type === "assistant" ? 1 : 0);
  }, 0);

  const fallback = new Date().toISOString();

  return {
    sessionId: first?.sessionId ?? basename((first as any)?.uuid ?? "unknown"),
    startedAt: minTs ?? fallback,
    lastActiveAt: maxTs ?? minTs ?? fallback,
    cwd: cwd ?? "",
    gitBranch,
    version,
    primaryModel,
    turnCount,
    customTitle,
    lastPrompt,
    entrypoint:
      typeof (first as any)?.entrypoint === "string"
        ? (first as any).entrypoint
        : undefined,
  };
}
