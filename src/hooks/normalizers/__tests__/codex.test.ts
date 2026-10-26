import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeCodex } from '../codex.js';

const fx = (n: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', '__tests__', 'fixtures', 'codex', `${n}.json`), 'utf8'));

describe('normalizeCodex (real captured payloads)', () => {
  it('common envelope: bare session id, rollout as transcript, model', () => {
    const e = normalizeCodex(fx('SessionStart'));
    expect(e).toMatchObject({
      agent: 'codex',
      event: 'SessionStart',
      sessionId: '01a17964-99a8-7d63-88cf-e4c3efb016c3',
      cwd: '/home/user/Downloads',
      model: 'gpt-6-luna',
      source: 'startup',
    });
    expect(e.transcriptPath).toMatch(/rollout-.*\.jsonl$/);
  });

  it('resume keeps source', () => {
    expect(normalizeCodex(fx('SessionStart-resume')).source).toBe('resume');
  });

  it('UserPromptSubmit prompt', () => {
    expect(normalizeCodex(fx('UserPromptSubmit')).prompt).toContain('validemos los hooks');
  });

  it('Bash tool => shell with command (PreToolUse and PostToolUse)', () => {
    for (const n of ['PreToolUse', 'PostToolUse']) {
      const t = normalizeCodex(fx(n)).tool!;
      expect(t.canonical).toBe('shell');
      expect(t.rawName).toBe('Bash');
      expect(t.command).toMatch(/^pwd && rg --files/);
    }
  });

  it('spawn tool (collaborationspawn_agent) => agent, WITHOUT subagent info (message is encrypted)', () => {
    const t = normalizeCodex(fx('PreToolUse-spawn_agent')).tool!;
    expect(t.canonical).toBe('agent');
    expect(t.subagent).toBeUndefined();
  });

  it('hooks fired inside a subagent carry agentType', () => {
    expect(normalizeCodex(fx('PreToolUse-subagent')).agentType).toBe('default');
    expect(normalizeCodex(fx('SubagentStart')).agentType).toBe('default');
  });

  it('PreCompact trigger, SessionEnd reason, Stop', () => {
    expect(normalizeCodex(fx('PreCompact')).trigger).toBe('manual');
    expect(normalizeCodex(fx('SessionEnd')).reason).toBe('other');
    expect(normalizeCodex(fx('Stop')).event).toBe('Stop');
  });

  it('apply_patch and MCP are classified but carry no file paths (noop until captured)', () => {
    const base = fx('PreToolUse');
    const patch = normalizeCodex({ ...base, tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: a.ts\n*** End Patch' } }).tool!;
    expect(patch.canonical).toBe('other');
    expect(patch.filePaths).toBeUndefined();
    expect(patch.command).toBeUndefined();
    const mcp = normalizeCodex({ ...base, tool_name: 'mcp__ctk__ctk_find', tool_input: {} }).tool!;
    expect(mcp.canonical).toBe('mcp');
  });

  it('tool_response arrives as a plain string and is not required', () => {
    expect(() => normalizeCodex(fx('PostToolUse'))).not.toThrow();
  });

  it('garbage in => safe defaults', () => {
    const e = normalizeCodex(null);
    expect(e.agent).toBe('codex');
    expect(e.sessionId).toBe('default');
  });
});
