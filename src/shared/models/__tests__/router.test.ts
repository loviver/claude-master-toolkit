import { describe, it, expect } from 'vitest';
import { resolveModel } from '../router.js';

const claude = { agent: 'claude-code' as const, current: 'sonnet' };
const codex = { agent: 'codex' as const, current: 'gpt-6-luna' };

describe('resolveModel', () => {
  it('pinned wins', () => expect(resolveModel({ ...claude, pref: 'pinned:claude-x', phase: 'general' })).toBe('claude-x'));
  it('inherit returns current', () => expect(resolveModel({ ...codex, pref: 'inherit', phase: 'sdd-design' })).toBe('gpt-6-luna'));

  it('auto: architectural phases -> high tier', () => {
    expect(resolveModel({ ...claude, pref: 'auto', phase: 'sdd-design' })).toBe('opus');
    expect(resolveModel({ ...claude, pref: 'smart', phase: 'orchestrator' })).toBe('opus');
  });
  it('auto: archive -> low tier', () => expect(resolveModel({ ...claude, pref: 'auto', phase: 'sdd-archive' })).toBe('haiku'));
  it('auto: everything else inherits (no sonnet default)', () => {
    expect(resolveModel({ ...claude, current: 'haiku', pref: 'auto', phase: 'sdd-apply' })).toBe('haiku');
  });

  it('legacy alias pref maps through the agent tier', () => {
    expect(resolveModel({ ...claude, pref: 'opus', phase: 'x' })).toBe('opus');
    expect(resolveModel({ ...codex, pref: 'opus', phase: 'x' })).toBe('gpt-6-luna'); // no verified Codex tiers -> inherit
  });

  it('phase can be a tier name', () => {
    expect(resolveModel({ ...claude, pref: 'auto', phase: 'high' })).toBe('opus');
    expect(resolveModel({ ...claude, pref: 'auto', phase: 'low' })).toBe('haiku');
    expect(resolveModel({ ...codex, pref: 'auto', phase: 'high' })).toBe('gpt-6-luna');
  });

  it('auto on codex degrades to inherit for every phase', () => {
    expect(resolveModel({ ...codex, pref: 'auto', phase: 'sdd-design' })).toBe('gpt-6-luna');
  });

  it('unknown pref falls back to current', () => expect(resolveModel({ ...claude, pref: 'weird', phase: 'x' })).toBe('sonnet'));
});
