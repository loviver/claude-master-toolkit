import { createHash } from 'crypto';
import { normalizeCodexUsage, type CodexRawUsage } from '../../../shared/models/codex-usage.js';
import { MAX_TOOL_INPUT_BYTES, MAX_TOOL_RESULT_BYTES, truncate } from '../../../shared/jsonl-parser/enrichment.js';
import type { EnrichedTokenEventData, ToolCallData } from '../../../shared/types/token-event.js';
import type { UserContentEntry } from '../../../shared/types/index.js';
import type { NormalizedSession } from './types.js';

/**
 * Codex rollout (`~/.codex/sessions/**\/rollout-*.jsonl`) → NormalizedSession.
 *
 * One `token_usage_record` per model response becomes one token event. The model's
 * output items (assistant text, reasoning, tool calls) precede their record, so they
 * are buffered until it arrives; user messages and tool outputs are the next
 * response's input. Content is normalized to ctk's canonical (Claude) block
 * vocabulary — text / tool_use / tool_result — so the pipeline and UI stay agnostic.
 */

export interface RolloutLine {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

type Block = Record<string, unknown>;

interface PendingToolCall {
  id: string;
  name: string;
  input: unknown;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((c) => str((c as Block)?.text) ?? '').join('');
}

function toolCallOf(p: Record<string, unknown>): PendingToolCall {
  if (p.type === 'custom_tool_call') {
    return { id: String(p.call_id), name: String(p.name), input: { input: p.input } };
  }
  let input: unknown = p.arguments;
  try {
    input = JSON.parse(String(p.arguments));
  } catch {
    /* keep raw arguments */
  }
  return { id: String(p.call_id), name: String(p.name), input };
}

function entrypointOf(source: unknown): string | undefined {
  if (typeof source === 'string') return source;
  if (source && typeof source === 'object') return Object.keys(source)[0];
  return undefined;
}

export function parseCodexRollout(
  lines: RolloutLine[],
  opts: { titleFor?: (sessionId: string) => string | undefined } = {},
): NormalizedSession {
  let meta: Record<string, unknown> = {};
  let minTs: string | undefined;
  let maxTs: string | undefined;
  let lastPrompt: string | undefined;
  let currentModel = 'unknown';
  let currentCwd: string | undefined;

  const modelByTurn = new Map<string, string>();
  const lastResponseByTurn = new Map<string, string>();
  const responseByCall = new Map<string, string>();
  const toolCallById = new Map<string, ToolCallData>();

  let outputBlocks: Block[] = [];
  let outputCalls: PendingToolCall[] = [];
  let sawReasoning = false;
  let pendingUser: string[] = [];

  const tokenEvents: EnrichedTokenEventData[] = [];
  const turnDurations = new Map<string, number>();
  const userContent: UserContentEntry[] = [];

  for (const line of lines) {
    const ts = line.timestamp;
    if (ts) {
      if (!minTs || ts < minTs) minTs = ts;
      if (!maxTs || ts > maxTs) maxTs = ts;
    }
    const p = line.payload ?? {};

    switch (line.type) {
      case 'session_meta':
        meta = p;
        break;

      case 'turn_context': {
        const model = str(p.model);
        if (model) {
          currentModel = model;
          if (typeof p.turn_id === 'string') modelByTurn.set(p.turn_id, model);
        }
        currentCwd = str(p.cwd) ?? currentCwd;
        break;
      }

      case 'response_item': {
        if (p.type === 'reasoning') {
          sawReasoning = true;
        } else if (p.type === 'message' && p.role === 'assistant') {
          outputBlocks.push({ type: 'text', text: textOf(p.content) });
        } else if (p.type === 'message' && p.role === 'user') {
          const text = textOf(p.content);
          pendingUser.push(JSON.stringify([{ type: 'text', text }]));
          if (text && !text.startsWith('<')) lastPrompt = text;
        } else if (p.type === 'custom_tool_call' || p.type === 'function_call') {
          const call = toolCallOf(p);
          outputCalls.push(call);
          outputBlocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
        } else if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') {
          const callId = String(p.call_id);
          const text = textOf(p.output);
          const tc = toolCallById.get(callId);
          if (tc) tc.resultContent = truncate(text, MAX_TOOL_RESULT_BYTES);
          const responseId = responseByCall.get(callId);
          if (responseId) {
            userContent.push({
              assistantUuid: responseId,
              role: 'tool_result',
              raw: JSON.stringify([{ type: 'tool_result', tool_use_id: callId, content: text }]),
            });
          }
        }
        break;
      }

      case 'token_usage_record': {
        const responseId = str(p.response_id);
        if (!responseId || !p.usage) break;
        const turnId = str(p.turn_id);
        const content = JSON.stringify(outputBlocks);
        const toolCalls: ToolCallData[] = outputCalls.map((c, idx) => {
          const tc: ToolCallData = {
            toolUseId: c.id,
            toolName: c.name,
            orderIdx: idx,
            inputJson: truncate(
              typeof c.input === 'string' ? c.input : JSON.stringify(c.input),
              MAX_TOOL_INPUT_BYTES,
            ),
            resultIsError: null,
            resultContent: null,
            resultStderr: null,
            resultStdout: null,
            resultExitCode: null,
          };
          toolCallById.set(c.id, tc);
          responseByCall.set(c.id, responseId);
          return tc;
        });

        tokenEvents.push({
          uuid: responseId,
          timestamp: ts ?? '',
          model: (turnId && modelByTurn.get(turnId)) || currentModel,
          usage: normalizeCodexUsage(p.usage as CodexRawUsage),
          toolsUsed: outputCalls.map((c) => c.name),
          stopReason: outputCalls.length > 0 ? 'tool_use' : 'end_turn',
          isSidechain: false,
          semanticPhase: 'unknown',
          content,
          contentHash: createHash('sha256').update(content).digest('hex'),
          messageId: responseId,
          hasThinking: sawReasoning,
          cwd: currentCwd ?? str(meta.cwd),
          toolCalls,
        });

        for (const raw of pendingUser) userContent.push({ assistantUuid: responseId, role: 'user', raw });
        if (turnId) lastResponseByTurn.set(turnId, responseId);
        outputBlocks = [];
        outputCalls = [];
        sawReasoning = false;
        pendingUser = [];
        break;
      }

      case 'event_msg': {
        const turnId = str(p.turn_id);
        const responseId = turnId && lastResponseByTurn.get(turnId);
        if (p.type === 'task_complete' && responseId && typeof p.duration_ms === 'number') {
          turnDurations.set(responseId, p.duration_ms);
        }
        break;
      }
    }
  }

  const modelCounts = new Map<string, number>();
  for (const e of tokenEvents) modelCounts.set(e.model, (modelCounts.get(e.model) ?? 0) + 1);
  const primaryModel = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  const sessionId = str(meta.id) ?? str(meta.session_id) ?? 'unknown';
  const cwd = str(meta.cwd) ?? currentCwd ?? '';
  const fallback = new Date().toISOString();
  const git = meta.git as { branch?: unknown } | undefined;

  return {
    meta: {
      sessionId,
      startedAt: minTs ?? fallback,
      lastActiveAt: maxTs ?? minTs ?? fallback,
      cwd,
      gitBranch: str(git?.branch),
      version: str(meta.cli_version),
      primaryModel,
      turnCount: tokenEvents.length,
      customTitle: opts.titleFor?.(sessionId),
      lastPrompt,
      entrypoint: entrypointOf(meta.source),
    },
    projectPath: cwd,
    tokenEvents,
    turnDurations,
    hooks: [],
    snapshots: [],
    userContent,
  };
}
