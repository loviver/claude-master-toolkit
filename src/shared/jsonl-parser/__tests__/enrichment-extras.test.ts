import { describe, it, expect } from 'vitest';
import { extractEnrichedTokenEvents } from '../enrichment';

describe('extractEnrichedTokenEvents — event_subtype/event_level', () => {
  it('captura subtype y level del assistant event cuando presentes', () => {
    const events = [
      {
        type: 'assistant',
        uuid: 'a1',
        sessionId: 's',
        timestamp: '2026-04-19T00:00:00Z',
        subtype: 'local_command',
        level: 'warn',
        message: { model: 'opus', usage: { input_tokens: 1, output_tokens: 1 }, content: [] },
      } as any,
    ];
    const [enriched] = extractEnrichedTokenEvents(events);
    expect(enriched.eventSubtype).toBe('local_command');
    expect(enriched.eventLevel).toBe('warn');
  });

  it('undefined cuando ausentes', () => {
    const events = [
      {
        type: 'assistant', uuid: 'a1', sessionId: 's', timestamp: '2026-04-19T00:00:00Z',
        message: { model: 'opus', usage: { input_tokens: 0, output_tokens: 0 }, content: [] },
      } as any,
    ];
    const [enriched] = extractEnrichedTokenEvents(events);
    expect(enriched.eventSubtype).toBeUndefined();
    expect(enriched.eventLevel).toBeUndefined();
  });
});
