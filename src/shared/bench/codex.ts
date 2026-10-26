/**
 * Pure helpers for benchmarking agents driven through `codex exec --json`.
 * Metrics come from Codex's own event stream and rollout log — never from the model's
 * self-report — so the same numbers can be reproduced from the raw files.
 */

export interface CodexUsage {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

export interface CodexRun {
  threadId: string | null;
  finalMessage: string;
  usage: CodexUsage;
  toolCalls: number;
  mcpCalls: number;
  mcpFailed: number;
  /** Error messages of failed MCP calls (e.g. approval denied) — friction, not noise. */
  mcpFailures: string[];
  shellCalls: number;
}

export interface McpCallTiming {
  tool: string;
  /** Time spent inside the MCP server (Codex `item.duration`). */
  serverMs: number;
  /** Item start → completion as seen by the Codex client (includes client overhead). */
  wallMs: number;
}

export interface Expectation {
  /** Substrings the answer must contain. */
  all: string[];
  /** Substrings that must NOT appear (decoys). */
  none?: string[];
}

export type Verdict = 'correct' | 'incomplete' | 'incorrect';

function tryParse(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function parseCodexStream(text: string): CodexRun {
  const run: CodexRun = {
    threadId: null,
    finalMessage: '',
    usage: { input: 0, cached: 0, output: 0, reasoning: 0 },
    toolCalls: 0,
    mcpCalls: 0,
    mcpFailed: 0,
    mcpFailures: [],
    shellCalls: 0,
  };

  for (const raw of text.split('\n')) {
    const ev = raw.trim().startsWith('{') ? tryParse(raw) : null;
    if (!ev) continue;

    if (ev.type === 'thread.started') run.threadId = ev.thread_id ?? null;

    if (ev.type === 'turn.completed' && ev.usage) {
      run.usage.input += ev.usage.input_tokens ?? 0;
      run.usage.cached += ev.usage.cached_input_tokens ?? 0;
      run.usage.output += ev.usage.output_tokens ?? 0;
      run.usage.reasoning += ev.usage.reasoning_output_tokens ?? 0;
    }

    if (ev.type !== 'item.completed' || !ev.item) continue;
    const item = ev.item;
    if (item.type === 'agent_message') run.finalMessage = item.text ?? '';
    else if (item.type === 'mcp_tool_call') {
      run.toolCalls++;
      run.mcpCalls++;
      if (item.status === 'failed' || item.error) {
        run.mcpFailed++;
        run.mcpFailures.push(item.error?.message ?? 'failed');
      }
    } else if (item.type === 'command_execution') {
      run.toolCalls++;
      run.shellCalls++;
    }
  }
  return run;
}

/** Server-side vs client-side timing of every MCP call in a Codex rollout JSONL. */
export function parseRolloutMcp(text: string): McpCallTiming[] {
  const out: McpCallTiming[] = [];
  for (const raw of text.split('\n')) {
    const rec = raw.trim() ? tryParse(raw) : null;
    const p = rec?.payload;
    if (p?.type !== 'item_completed' || p.item?.type !== 'McpToolCall') continue;
    const d = p.item.duration ?? { secs: 0, nanos: 0 };
    out.push({
      tool: p.item.tool,
      serverMs: Math.round(((d.secs ?? 0) * 1000 + (d.nanos ?? 0) / 1e6) * 10) / 10,
      wallMs: (p.completed_at_ms ?? 0) - (p.started_at_ms ?? 0),
    });
  }
  return out;
}

export function verdict(answer: string, expect: Expectation): Verdict {
  if (!answer.trim()) return 'incorrect';
  if ((expect.none ?? []).some((s) => answer.includes(s))) return 'incorrect';
  const hit = expect.all.filter((s) => answer.includes(s)).length;
  if (hit === expect.all.length) return 'correct';
  return hit === 0 ? 'incorrect' : 'incomplete';
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
