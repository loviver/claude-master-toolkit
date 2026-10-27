import { describe, it, expect } from 'vitest';
import { extractUserContent } from '../index.js';
import type { SessionEvent } from '../../types/index.js';

const ev = (e: Record<string, unknown>) => e as unknown as SessionEvent;

describe('extractUserContent', () => {
  it('attaches a tool result to the assistant turn that requested it', () => {
    const content = [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }];
    const out = extractUserContent([
      ev({ type: 'assistant', uuid: 'a1', message: { content: [] } }),
      ev({ type: 'user', uuid: 'u1', sourceToolAssistantUUID: 'a1', message: { content } }),
    ]);
    expect(out).toEqual([{ assistantUuid: 'a1', role: 'tool_result', raw: JSON.stringify(content) }]);
  });

  it('attaches a plain prompt to the next assistant turn', () => {
    const out = extractUserContent([
      ev({ type: 'user', uuid: 'u1', message: { content: 'hi' } }),
      ev({ type: 'system', uuid: 's1' }),
      ev({ type: 'assistant', uuid: 'a1', message: { content: [] } }),
    ]);
    expect(out).toEqual([{ assistantUuid: 'a1', role: 'user', raw: '"hi"' }]);
  });

  it('drops prompts with no following assistant turn or no message', () => {
    const out = extractUserContent([
      ev({ type: 'user', uuid: 'u0' }),
      ev({ type: 'user', uuid: 'u1', message: { content: 'pending' } }),
    ]);
    expect(out).toEqual([]);
  });

  it('stops at the next assistant turn even when it has no uuid', () => {
    const out = extractUserContent([
      ev({ type: 'user', uuid: 'u1', message: { content: 'hi' } }),
      ev({ type: 'assistant', message: { content: [] } }),
      ev({ type: 'assistant', uuid: 'a2', message: { content: [] } }),
    ]);
    expect(out).toEqual([]);
  });
});
