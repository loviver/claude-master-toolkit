import { describe, it, expect } from 'vitest';
import { extractSessionMeta } from '../token-extraction';

describe('extractSessionMeta — campos extras (customTitle, lastPrompt, entrypoint)', () => {
  it('extrae customTitle de evento con summary/customTitle', () => {
    const events = [
      { type: 'summary', summary: 'My Custom Title', leafUuid: 'x' } as any,
      { type: 'assistant', uuid: 'a', sessionId: 's', timestamp: '2026-04-19T00:00:00Z', message: { model: 'opus', usage: {} } } as any,
    ];
    const meta = extractSessionMeta(events);
    expect(meta.customTitle).toBe('My Custom Title');
  });

  it('extrae lastPrompt del último user event con texto', () => {
    const events = [
      { type: 'user', uuid: 'u1', sessionId: 's', timestamp: '2026-04-19T00:00:00Z', message: { role: 'user', content: 'primero' } } as any,
      { type: 'user', uuid: 'u2', sessionId: 's', timestamp: '2026-04-19T00:01:00Z', message: { role: 'user', content: 'último prompt' } } as any,
    ];
    const meta = extractSessionMeta(events);
    expect(meta.lastPrompt).toBe('último prompt');
  });

  it('extrae entrypoint del primer evento', () => {
    const events = [
      { type: 'user', uuid: 'u1', sessionId: 's', timestamp: '2026-04-19T00:00:00Z', entrypoint: 'cli', message: { role: 'user', content: 'hola' } } as any,
    ];
    const meta = extractSessionMeta(events);
    expect(meta.entrypoint).toBe('cli');
  });

  it('campos undefined cuando no presentes', () => {
    const events = [
      { type: 'assistant', uuid: 'a', sessionId: 's', timestamp: '2026-04-19T00:00:00Z', message: { model: 'opus', usage: {} } } as any,
    ];
    const meta = extractSessionMeta(events);
    expect(meta.customTitle).toBeUndefined();
    expect(meta.lastPrompt).toBeUndefined();
    expect(meta.entrypoint).toBeUndefined();
  });
});
