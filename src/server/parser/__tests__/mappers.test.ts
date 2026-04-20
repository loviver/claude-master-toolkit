import { describe, it, expect } from 'vitest';
import { metaToSessionInsert, metaToSessionUpdate } from '../mappers/meta-to-session-row.js';
import { eventToTokenRow } from '../mappers/event-to-token-row.js';
import { eventToToolCalls } from '../mappers/event-to-tool-calls.js';
import { eventToAssistantContent } from '../mappers/event-to-assistant-content.js';
import { hookToRow } from '../mappers/hook-to-row.js';
import { snapshotToRows } from '../mappers/snapshot-to-rows.js';
import type { SessionMeta } from '../types.js';
import type { EnrichedTokenEventData } from '../../../shared/types/token-event.js';
import type { HookAttachment, FileHistorySnapshot } from '../../../shared/types/dashboard.js';
import type { TokenUsage } from '../../../shared/types/index.js';

const meta: SessionMeta = {
  sessionId: 'sess-1',
  startedAt: '2024-01-01T00:00:00Z',
  lastActiveAt: '2024-01-01T01:00:00Z',
  cwd: '/home/user/project',
  primaryModel: 'claude-3-5-haiku-20241022',
  turnCount: 3,
};
const totals: TokenUsage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 5, cacheCreationTokens: 2 };
const cost = 0.001;

describe('metaToSessionInsert', () => {
  it('maps meta + totals to insert row', () => {
    const row = metaToSessionInsert(meta, totals, cost, '/path/to/file.jsonl', '/home/user/project');
    expect(row.id).toBe('sess-1');
    expect(row.primaryModel).toBe('claude-3-5-haiku-20241022');
    expect(row.totalInputTokens).toBe(100);
    expect(row.totalCostUsd).toBe(0.001);
    expect(row.jsonlFile).toBe('/path/to/file.jsonl');
  });
});

describe('metaToSessionUpdate', () => {
  it('maps meta + totals to update set', () => {
    const row = metaToSessionUpdate(meta, totals, cost);
    expect(row.turnCount).toBe(3);
    expect(row.totalOutputTokens).toBe(50);
  });
});

const baseEvt: EnrichedTokenEventData = {
  uuid: 'uuid-abc',
  timestamp: '2024-01-01T00:00:00Z',
  model: 'claude-3-5-haiku-20241022',
  usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 5, cacheCreationTokens: 2 },
  toolsUsed: ['Read', 'Grep'],
  stopReason: 'end_turn',
  isSidechain: false,
  semanticPhase: 'exploration',
};

describe('eventToTokenRow', () => {
  it('maps event to token_events row', () => {
    const row = eventToTokenRow(baseEvt, 'sess-1', null);
    expect(row.sessionId).toBe('sess-1');
    expect(row.uuid).toBe('uuid-abc');
    expect(row.model).toBe('claude-3-5-haiku-20241022');
    expect(row.inputTokens).toBe(100);
    expect(row.toolsUsed).toBe('["Read","Grep"]');
    expect(row.durationMs).toBeNull();
  });
});

describe('eventToToolCalls', () => {
  it('returns empty array when no toolCalls', () => {
    expect(eventToToolCalls(baseEvt, 99)).toEqual([]);
  });

  it('maps toolCalls to rows with eventId', () => {
    const evt = { ...baseEvt, toolCalls: [{ toolUseId: 'tc1', toolName: 'Read', orderIdx: 0, inputJson: '{}', resultIsError: null, resultContent: null, resultStderr: null, resultStdout: null, resultExitCode: null }] };
    const rows = eventToToolCalls(evt, 42);
    expect(rows).toHaveLength(1);
    expect(rows[0].eventId).toBe(42);
    expect(rows[0].toolName).toBe('Read');
  });
});

describe('eventToAssistantContent', () => {
  it('returns null when no content', () => {
    expect(eventToAssistantContent(baseEvt, 1)).toBeNull();
  });

  it('maps content to turnContent row', () => {
    const evt = { ...baseEvt, content: 'hello', contentHash: 'abc123' };
    const row = eventToAssistantContent(evt, 7);
    expect(row).not.toBeNull();
    expect(row!.role).toBe('assistant');
    expect(row!.eventId).toBe(7);
  });
});

describe('hookToRow', () => {
  it('maps hook with resolved eventId', () => {
    const hook: HookAttachment = {
      hookName: 'UserPromptSubmit',
      hookEvent: 'UserPromptSubmit',
      timestamp: '2024-01-01T00:00:00Z',
      parentUuid: 'uuid-abc',
    };
    const uuidMap = new Map([['uuid-abc', 5]]);
    const row = hookToRow(hook, 'sess-1', uuidMap);
    expect(row.eventId).toBe(5);
    expect(row.hookName).toBe('UserPromptSubmit');
  });

  it('resolves null eventId when parentUuid missing', () => {
    const hook: HookAttachment = {
      hookName: 'SessionStart',
      hookEvent: 'SessionStart',
      timestamp: '2024-01-01T00:00:00Z',
    };
    const row = hookToRow(hook, 'sess-1', new Map());
    expect(row.eventId).toBeNull();
  });
});

describe('snapshotToRows', () => {
  it('maps snapshot files to turnFileChanges rows', () => {
    const snap: FileHistorySnapshot = {
      messageId: 'uuid-abc',
      isSnapshotUpdate: false,
      files: ['src/foo.ts', 'src/bar.ts'],
    };
    const uuidMap = new Map([['uuid-abc', 10]]);
    const rows = snapshotToRows(snap, 'sess-1', uuidMap);
    expect(rows).toHaveLength(2);
    expect(rows[0].filePath).toBe('src/foo.ts');
    expect(rows[0].eventId).toBe(10);
  });
});
