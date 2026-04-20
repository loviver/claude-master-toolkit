import { createHash } from 'crypto';
import type { SessionEvent, SemanticPhase, EnrichedTokenEventData, ToolCallData } from '../types/index.js';

const MAX_TOOL_INPUT_BYTES = 16 * 1024;
const MAX_TOOL_RESULT_BYTES = 4 * 1024;
const MAX_THINKING_BYTES = 8 * 1024;

function truncate(s: string | undefined | null, max: number): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) + '…[truncated]' : s;
}

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

function extractThinking(content: unknown): { text: string | null; signature: string | null } {
  if (!Array.isArray(content)) return { text: null, signature: null };
  const parts: string[] = [];
  let signature: string | null = null;
  for (const b of content) {
    if (typeof b !== 'object' || b === null) continue;
    const rec = b as Record<string, unknown>;
    if (rec.type !== 'thinking') continue;
    if (typeof rec.thinking === 'string') parts.push(rec.thinking);
    else if (typeof rec.text === 'string') parts.push(rec.text);
    if (!signature && typeof rec.signature === 'string') signature = rec.signature;
  }
  if (!parts.length) return { text: null, signature };
  return { text: truncate(parts.join('\n\n'), MAX_THINKING_BYTES), signature };
}

function extractToolUseBlocks(content: unknown): Array<{ id: string; name: string; input: unknown }> {
  if (!Array.isArray(content)) return [];
  const out: Array<{ id: string; name: string; input: unknown }> = [];
  for (const b of content) {
    if (typeof b !== 'object' || b === null) continue;
    const rec = b as Record<string, unknown>;
    if (rec.type !== 'tool_use') continue;
    const id = typeof rec.id === 'string' ? rec.id : '';
    const name = typeof rec.name === 'string' ? rec.name : 'unknown';
    if (!id) continue;
    out.push({ id, name, input: rec.input });
  }
  return out;
}

/**
 * Scan all events once and build tool_use_id → tool_result payload map.
 * tool_result blocks live inside user events (`message.content` array).
 */
function buildToolResultMap(events: SessionEvent[]): Map<string, {
  isError: boolean | null;
  content: string | null;
  stderr: string | null;
  stdout: string | null;
  exitCode: number | null;
}> {
  const map = new Map<string, {
    isError: boolean | null;
    content: string | null;
    stderr: string | null;
    stdout: string | null;
    exitCode: number | null;
  }>();

  for (const e of events) {
    if (e.type !== 'user' || !('message' in e) || !e.message) continue;
    const content = e.message.content;
    const toolResult = (e as { toolUseResult?: { stdout?: string; stderr?: string; exitCode?: number; interrupted?: boolean } }).toolUseResult;

    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (typeof b !== 'object' || b === null) continue;
      const rec = b as Record<string, unknown>;
      if (rec.type !== 'tool_result') continue;
      const id = typeof rec.tool_use_id === 'string' ? rec.tool_use_id : '';
      if (!id) continue;

      let contentStr: string | null = null;
      if (typeof rec.content === 'string') contentStr = rec.content;
      else if (Array.isArray(rec.content)) {
        const parts: string[] = [];
        for (const c of rec.content) {
          if (typeof c === 'object' && c !== null) {
            const cr = c as Record<string, unknown>;
            if (typeof cr.text === 'string') parts.push(cr.text);
          } else if (typeof c === 'string') parts.push(c);
        }
        contentStr = parts.join('\n');
      } else if (rec.content !== undefined) {
        try { contentStr = JSON.stringify(rec.content); } catch { contentStr = null; }
      }

      map.set(id, {
        isError: typeof rec.is_error === 'boolean' ? rec.is_error : null,
        content: truncate(contentStr, MAX_TOOL_RESULT_BYTES),
        stderr: truncate(toolResult?.stderr, MAX_TOOL_RESULT_BYTES),
        stdout: truncate(toolResult?.stdout, MAX_TOOL_RESULT_BYTES),
        exitCode: typeof toolResult?.exitCode === 'number' ? toolResult.exitCode : null,
      });
    }
  }
  return map;
}

function extractToolCalls(
  content: unknown,
  resultMap: Map<string, ReturnType<typeof buildToolResultMap> extends Map<string, infer V> ? V : never>,
): ToolCallData[] {
  const blocks = extractToolUseBlocks(content);
  return blocks.map((b, idx) => {
    let inputJson: string | null = null;
    try {
      inputJson = truncate(JSON.stringify(b.input), MAX_TOOL_INPUT_BYTES);
    } catch { inputJson = null; }
    const r = resultMap.get(b.id);
    return {
      toolUseId: b.id,
      toolName: b.name,
      orderIdx: idx,
      inputJson,
      resultIsError: r?.isError ?? null,
      resultContent: r?.content ?? null,
      resultStderr: r?.stderr ?? null,
      resultStdout: r?.stdout ?? null,
      resultExitCode: r?.exitCode ?? null,
    };
  });
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

  const resultMap = buildToolResultMap(events);

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
    const thinking = extractThinking(content);
    const toolCalls = extractToolCalls(content, resultMap);
    const evRec = e as unknown as Record<string, unknown>;

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
      thinkingText: thinking.text ?? undefined,
      thinkingSignature: thinking.signature ?? undefined,
      promptId: typeof evRec.promptId === 'string' ? evRec.promptId : undefined,
      cwd: typeof evRec.cwd === 'string' ? evRec.cwd : undefined,
      gitBranch: typeof evRec.gitBranch === 'string' ? evRec.gitBranch : undefined,
      isMeta: typeof evRec.isMeta === 'boolean' ? evRec.isMeta : undefined,
      isCompactSummary: typeof evRec.isCompactSummary === 'boolean' ? evRec.isCompactSummary : undefined,
      userType: typeof evRec.userType === 'string' ? evRec.userType : undefined,
      eventSubtype: typeof evRec.subtype === 'string' ? evRec.subtype : undefined,
      eventLevel: typeof evRec.level === 'string' ? evRec.level : undefined,
      toolCalls,
    });
  }
  return result;
}
