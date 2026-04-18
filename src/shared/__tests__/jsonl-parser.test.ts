import { describe, it, expect } from 'vitest';
import {
  extractToolNames,
  inferSemanticPhase,
  extractEnrichedTokenEvents,
} from '../jsonl-parser.js';
import type { SessionEvent } from '../types.js';

// ── extractToolNames ──

describe('extractToolNames', () => {
  it('extracts tool names from content blocks', () => {
    const content = [
      { type: 'text', text: 'Let me read the file.' },
      { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/foo' } },
      { type: 'tool_use', id: 'tu_2', name: 'Grep', input: { pattern: 'bar' } },
    ];
    expect(extractToolNames(content)).toEqual(['Read', 'Grep']);
  });

  it('returns empty array for text-only content', () => {
    const content = [{ type: 'text', text: 'Hello' }];
    expect(extractToolNames(content)).toEqual([]);
  });

  it('returns empty array for string content', () => {
    expect(extractToolNames('just a string')).toEqual([]);
  });

  it('returns empty array for null/undefined', () => {
    expect(extractToolNames(null)).toEqual([]);
    expect(extractToolNames(undefined)).toEqual([]);
  });

  it('deduplicates tool names', () => {
    const content = [
      { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} },
      { type: 'tool_use', id: 'tu_2', name: 'Read', input: {} },
      { type: 'tool_use', id: 'tu_3', name: 'Edit', input: {} },
    ];
    expect(extractToolNames(content)).toEqual(['Read', 'Edit']);
  });

  it('handles thinking blocks mixed with tool_use', () => {
    const content = [
      { type: 'thinking', thinking: '...', signature: 'sig' },
      { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
    ];
    expect(extractToolNames(content)).toEqual(['Bash']);
  });
});

// ── inferSemanticPhase ──

describe('inferSemanticPhase', () => {
  it('returns "exploration" for read-only tools', () => {
    expect(inferSemanticPhase(['Read', 'Grep', 'Glob'])).toBe('exploration');
  });

  it('returns "implementation" for write tools', () => {
    expect(inferSemanticPhase(['Edit', 'Write'])).toBe('implementation');
  });

  it('returns "testing" for Bash with test commands', () => {
    expect(inferSemanticPhase(['Bash'], ['vitest run'])).toBe('testing');
    expect(inferSemanticPhase(['Bash'], ['npm run test'])).toBe('testing');
    expect(inferSemanticPhase(['Bash'], ['jest --watch'])).toBe('testing');
    expect(inferSemanticPhase(['Bash'], ['pytest -v'])).toBe('testing');
  });

  it('returns "implementation" for Bash without test commands', () => {
    expect(inferSemanticPhase(['Bash'], ['npm install foo'])).toBe('implementation');
  });

  it('returns "implementation" when mix includes write tools', () => {
    expect(inferSemanticPhase(['Read', 'Edit'])).toBe('implementation');
  });

  it('returns "unknown" for empty tools', () => {
    expect(inferSemanticPhase([])).toBe('unknown');
  });

  it('returns "exploration" for Agent/Explore tools', () => {
    expect(inferSemanticPhase(['Agent'])).toBe('exploration');
  });
});

// ── extractEnrichedTokenEvents ──

describe('extractEnrichedTokenEvents', () => {
  const makeAssistantEvent = (overrides: Partial<SessionEvent> = {}): SessionEvent => ({
    type: 'assistant',
    uuid: 'uuid-1',
    sessionId: 'sess-1',
    timestamp: '2026-04-12T10:00:00Z',
    parentUuid: 'parent-1',
    isSidechain: false,
    message: {
      role: 'assistant',
      model: 'claude-haiku-4-5-20251001',
      content: [
        { type: 'text', text: 'Reading file.' },
        { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/x' } },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 100,
      },
    },
    ...overrides,
  });

  it('extracts enriched fields from assistant events', () => {
    const events = [makeAssistantEvent()];
    const result = extractEnrichedTokenEvents(events);

    expect(result).toHaveLength(1);
    expect(result[0].toolsUsed).toEqual(['Read']);
    expect(result[0].stopReason).toBe('tool_use');
    expect(result[0].isSidechain).toBe(false);
    expect(result[0].parentUuid).toBe('parent-1');
    expect(result[0].semanticPhase).toBe('exploration');
    expect(result[0].model).toBe('claude-haiku-4-5-20251001');
    expect(result[0].usage.inputTokens).toBe(1000);
  });

  it('includes stringified content and hash', () => {
    const events = [makeAssistantEvent()];
    const result = extractEnrichedTokenEvents(events);

    expect(result[0].content).toBeDefined();
    expect(typeof result[0].content).toBe('string');
    expect(result[0].contentHash).toBeDefined();
    expect(result[0].contentHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it('skips non-assistant events', () => {
    const events: SessionEvent[] = [
      { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2026-04-12T10:00:00Z' },
      makeAssistantEvent(),
      { type: 'system', uuid: 'u2', sessionId: 's1', timestamp: '2026-04-12T10:01:00Z' },
    ];
    const result = extractEnrichedTokenEvents(events);
    expect(result).toHaveLength(1);
  });

  it('skips assistant events without usage', () => {
    const event = makeAssistantEvent();
    delete event.message!.usage;
    expect(extractEnrichedTokenEvents([event])).toHaveLength(0);
  });

  it('detects sidechain events', () => {
    const events = [makeAssistantEvent({ isSidechain: true })];
    const result = extractEnrichedTokenEvents(events);
    expect(result[0].isSidechain).toBe(true);
  });

  it('extracts bash commands for phase inference', () => {
    const event = makeAssistantEvent({
      message: {
        role: 'assistant',
        model: 'claude-haiku-4-5-20251001',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'npm run test' } },
        ],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 500,
          output_tokens: 100,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    });
    const result = extractEnrichedTokenEvents([event]);
    expect(result[0].semanticPhase).toBe('testing');
  });
});
