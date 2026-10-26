import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveAgentId, currentSessionId } from '../resolve.js';

const KEYS = ['CTK_AGENT', 'CTK_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDECODE', 'CODEX_SESSION_ID', 'CODEX_HOME', 'CODEX_THREAD_ID'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('resolveAgentId', () => {
  it('defaults to claude-code', () => expect(resolveAgentId()).toBe('claude-code'));
  it('flag beats env', () => {
    process.env['CTK_AGENT'] = 'claude-code';
    expect(resolveAgentId('codex')).toBe('codex');
  });
  it('CTK_AGENT beats sniffing', () => {
    process.env['CTK_AGENT'] = 'codex';
    process.env['CLAUDECODE'] = '1';
    expect(resolveAgentId()).toBe('codex');
  });
  it('sniffs codex env', () => {
    process.env['CODEX_SESSION_ID'] = 'x';
    expect(resolveAgentId()).toBe('codex');
  });
  it('sniffs claude env', () => {
    process.env['CLAUDECODE'] = '1';
    expect(resolveAgentId()).toBe('claude-code');
  });
  it('rejects unknown flag', () => expect(() => resolveAgentId('nope')).toThrow(/Unknown agent/));
});

describe('currentSessionId', () => {
  it('undefined when nothing set', () => expect(currentSessionId()).toBeUndefined());
  it('CTK_SESSION_ID wins', () => {
    process.env['CTK_SESSION_ID'] = 'c';
    process.env['CLAUDE_SESSION_ID'] = 'a';
    expect(currentSessionId()).toBe('c');
  });
  it('claude env', () => {
    process.env['CLAUDE_SESSION_ID'] = 'a';
    expect(currentSessionId()).toBe('a');
  });
  it('codex env, prefixed codex:', () => {
    process.env['CODEX_SESSION_ID'] = 'z';
    expect(currentSessionId()).toBe('codex:z');
  });
});
