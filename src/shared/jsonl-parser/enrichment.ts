import { createHash } from 'crypto';
import type { SessionEvent, SemanticPhase, EnrichedTokenEventData } from '../types/index.js';

// ── Phase classification tables ──

const EXPLORATION_TOOLS = new Set(['Read', 'Grep', 'Glob', 'Agent', 'Explore', 'WebSearch', 'WebFetch']);
const IMPLEMENTATION_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const TEST_PATTERNS = [/\bvitest\b/, /\bjest\b/, /\bpytest\b/, /\btest\b/, /\bspec\b/];

// ── Content block inspection ──

/**
 * Extract tool names from assistant message content blocks.
 * Returns deduplicated array preserving first-occurrence order.
 */
export function extractToolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).type === 'tool_use' &&
      typeof (block as Record<string, unknown>).name === 'string'
    ) {
      const name = (block as Record<string, unknown>).name as string;
      if (!seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
    }
  }
  return result;
}

/**
 * Extract bash commands from content blocks for phase inference.
 */
function extractBashCommands(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const cmds: string[] = [];
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).type === 'tool_use' &&
      (block as Record<string, unknown>).name === 'Bash'
    ) {
      const input = (block as Record<string, unknown>).input as Record<string, unknown> | undefined;
      if (input && typeof input.command === 'string') {
        cmds.push(input.command);
      }
    }
  }
  return cmds;
}

function contentHasThinking(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (b) =>
      typeof b === 'object' &&
      b !== null &&
      (b as Record<string, unknown>).type === 'thinking',
  );
}

// ── Semantic phase inference ──

/**
 * Infer the semantic phase of a turn based on tools used and bash commands.
 */
export function inferSemanticPhase(tools: string[], bashCommands: string[] = []): SemanticPhase {
  if (tools.length === 0) return 'unknown';

  if (tools.includes('Bash') && bashCommands.some((cmd) => TEST_PATTERNS.some((p) => p.test(cmd)))) {
    return 'testing';
  }

  if (tools.some((t) => IMPLEMENTATION_TOOLS.has(t))) return 'implementation';
  if (tools.includes('Bash')) return 'implementation';
  if (tools.every((t) => EXPLORATION_TOOLS.has(t))) return 'exploration';

  return 'unknown';
}

// ── Enriched event extraction ──

/**
 * Extract enriched token events with tool usage, phase, content, and metadata.
 */
export function extractEnrichedTokenEvents(events: SessionEvent[]): EnrichedTokenEventData[] {
  // Fold permission-mode events by position (no timestamps on them).
  const modeByIdx: string[] = new Array(events.length);
  let currentMode = 'default';
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev?.type === 'permission-mode' && typeof ev.permissionMode === 'string') {
      currentMode = ev.permissionMode;
    }
    modeByIdx[i] = currentMode;
  }

  const result: EnrichedTokenEventData[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type !== 'assistant' || !e.message?.usage) continue;

    const content = e.message.content;
    const toolsUsed = extractToolNames(content);
    const bashCommands = extractBashCommands(content);
    const contentStr = JSON.stringify(content);
    const contentHash = createHash('sha256').update(contentStr).digest('hex');
    const usage = e.message.usage;

    result.push({
      uuid: e.uuid,
      timestamp: e.timestamp,
      model: e.message.model ?? 'unknown',
      usage: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      },
      toolsUsed,
      stopReason: e.message.stop_reason ?? 'unknown',
      isSidechain: e.isSidechain ?? false,
      parentUuid: e.parentUuid,
      semanticPhase: inferSemanticPhase(toolsUsed, bashCommands),
      content: contentStr,
      contentHash,
      messageId: e.message.id,
      requestId: e.requestId,
      slug: e.slug,
      apiErrorStatus: e.apiErrorStatus,
      isApiError: !!e.isApiErrorMessage,
      serviceTier: usage.service_tier,
      speed: usage.speed,
      cache1h: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
      cache5m: usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
      webSearchCount: usage.server_tool_use?.web_search_requests ?? 0,
      webFetchCount: usage.server_tool_use?.web_fetch_requests ?? 0,
      iterationsCount: Array.isArray(usage.iterations) ? usage.iterations.length : 0,
      hasThinking: contentHasThinking(content),
      permissionMode: modeByIdx[i],
    });
  }
  return result;
}
