import { describe, it, expect } from 'vitest';
import { parseCodexStream, parseRolloutMcp, verdict, median } from '../codex.js';

const line = (o: unknown) => JSON.stringify(o);

describe('parseCodexStream', () => {
  const stream = [
    'Reading additional input from stdin...',
    line({ type: 'thread.started', thread_id: 'T1' }),
    line({ type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'thinking' } }),
    line({ type: 'item.completed', item: { id: 'b', type: 'mcp_tool_call', server: 'ctk', tool: 'ctk_find', status: 'completed', error: null } }),
    line({ type: 'item.completed', item: { id: 'c', type: 'mcp_tool_call', server: 'ctk', tool: 'ctk_deps', status: 'failed', error: { message: 'MCP tool call requires approval' } } }),
    line({ type: 'item.completed', item: { id: 'd', type: 'command_execution', command: 'rg foo', status: 'completed' } }),
    line({ type: 'item.completed', item: { id: 'e', type: 'agent_message', text: 'FINAL' } }),
    line({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 10, reasoning_output_tokens: 4 } }),
  ].join('\n');

  it('extracts thread id, last agent message and usage, ignoring non-JSON lines', () => {
    const r = parseCodexStream(stream);
    expect(r.threadId).toBe('T1');
    expect(r.finalMessage).toBe('FINAL');
    expect(r.usage).toEqual({ input: 100, cached: 60, output: 10, reasoning: 4 });
  });

  it('counts tool calls by kind and separates failed MCP calls (friction)', () => {
    const r = parseCodexStream(stream);
    expect(r.mcpCalls).toBe(2);
    expect(r.mcpFailed).toBe(1);
    expect(r.mcpFailures).toEqual(['MCP tool call requires approval']);
    expect(r.shellCalls).toBe(1);
    expect(r.toolCalls).toBe(3);
  });

  it('sums usage across multiple turns', () => {
    const two = [
      line({ type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 0 } }),
      line({ type: 'turn.completed', usage: { input_tokens: 3, cached_input_tokens: 1, output_tokens: 4, reasoning_output_tokens: 1 } }),
    ].join('\n');
    expect(parseCodexStream(two).usage).toEqual({ input: 4, cached: 1, output: 6, reasoning: 1 });
  });
});

describe('parseRolloutMcp', () => {
  it('returns server-side duration and client wall per MCP call', () => {
    const rollout = [
      line({ payload: { type: 'item_completed', started_at_ms: 1000, completed_at_ms: 12000, item: { type: 'McpToolCall', tool: 'ctk_understand', duration: { secs: 0, nanos: 4_500_000 } } } }),
      line({ payload: { type: 'item_completed', started_at_ms: 1, completed_at_ms: 2, item: { type: 'CommandExecution' } } }),
    ].join('\n');
    expect(parseRolloutMcp(rollout)).toEqual([{ tool: 'ctk_understand', serverMs: 4.5, wallMs: 11000 }]);
  });
});

describe('verdict', () => {
  const expectAll = { all: ['a.ts', 'b.ts'], none: ['z.ts'] };
  it('correct when every expected item is present and no forbidden one', () => {
    expect(verdict('see a.ts and b.ts', expectAll)).toBe('correct');
  });
  it('incomplete when some expected items are missing', () => {
    expect(verdict('only a.ts', expectAll)).toBe('incomplete');
  });
  it('incorrect when nothing expected is present or a forbidden item appears', () => {
    expect(verdict('nothing', expectAll)).toBe('incorrect');
    expect(verdict('a.ts b.ts z.ts', expectAll)).toBe('incorrect');
  });
  it('incorrect on an empty answer', () => {
    expect(verdict('', expectAll)).toBe('incorrect');
  });
});

describe('median', () => {
  it('handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
