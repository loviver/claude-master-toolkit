import { describe, it, expect } from 'vitest';
import { agentGuard } from '../agent-guard.js';
import type { HookEvent } from '../../runtime/types.js';

const ev = (sub: { type?: string; prompt?: string; model?: string }): HookEvent => ({
  agent: 'claude-code',
  event: 'PreToolUse',
  sessionId: 's',
  cwd: '/x',
  tool: { canonical: 'agent', rawName: 'Agent', input: {}, subagent: sub },
  raw: {},
});
const BRIEF = 'ctk_brief_read(id=abc) then work';

describe('agentGuard', () => {
  it.each(['Explore', 'Plan', 'claude-code-guide', 'statusline-setup', 'sdd-orchestrator'])(
    'trusted type %s is silent',
    (type) => {
      expect(agentGuard(ev({ type }), { strict: true })).toEqual({ kind: 'noop' });
    },
  );

  it('brief + model => silent', () => {
    expect(agentGuard(ev({ type: 'general-purpose', prompt: BRIEF, model: 'sonnet' }), { strict: false })).toEqual({
      kind: 'noop',
    });
  });

  it('non-strict: hint with both reasons', () => {
    const r = agentGuard(ev({ type: 'general-purpose', prompt: 'do it' }), { strict: false });
    expect(r.kind).toBe('context');
    const t = (r as { text: string }).text;
    expect(t).toContain('missing brief preamble (ctk_brief_read marker not found); model param omitted');
    expect(t).toContain('Non-blocking.');
  });

  it('non-strict: only model missing', () => {
    const r = agentGuard(ev({ type: 'x', prompt: BRIEF }), { strict: false });
    expect((r as { text: string }).text).toContain('(model param omitted)');
  });

  it('strict: blocks with /delegate instructions', () => {
    const r = agentGuard(ev({ type: 'x', prompt: 'p', model: 'sonnet' }), { strict: true });
    expect(r.kind).toBe('block');
    expect((r as { reason: string }).reason).toContain('✗ Blocked Agent call: missing brief preamble');
    expect((r as { reason: string }).reason).toContain('/delegate');
  });

  it('ignores non-agent events', () => {
    expect(agentGuard({ ...ev({}), tool: undefined }, { strict: true })).toEqual({ kind: 'noop' });
  });
});
