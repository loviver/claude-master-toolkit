import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeClaude } from '../claude-code.js';

const fx = (n: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', '__tests__', 'fixtures', 'claude-code', `${n}.json`), 'utf8'));

describe('normalizeClaude', () => {
  it('maps the common envelope', () => {
    const e = normalizeClaude(fx('SessionStart'));
    expect(e).toMatchObject({
      agent: 'claude-code',
      event: 'SessionStart',
      sessionId: 's-1',
      cwd: '/home/user/proj',
      transcriptPath: '/home/user/.claude/projects/p/s-1.jsonl',
      source: 'startup',
      model: 'claude-sonnet-5-5',
    });
  });

  it('UserPromptSubmit keeps the prompt', () => {
    expect(normalizeClaude(fx('UserPromptSubmit')).prompt).toBe('/task fix-auth');
  });

  it('Bash -> shell with command', () => {
    const t = normalizeClaude(fx('PreToolUse-Bash')).tool!;
    expect(t.canonical).toBe('shell');
    expect(t.command).toBe('git commit -m "x"');
  });

  it('Edit -> edit with filePaths', () => {
    const t = normalizeClaude(fx('PreToolUse-Edit')).tool!;
    expect(t.canonical).toBe('edit');
    expect(t.filePaths).toEqual(['/home/user/proj/src/a.ts']);
  });

  it('Write -> write with filePaths', () => {
    const t = normalizeClaude(fx('PostToolUse-Write')).tool!;
    expect(t.canonical).toBe('write');
    expect(t.filePaths).toEqual(['/home/user/proj/src/b.ts']);
  });

  it('Agent -> agent with subagent info', () => {
    const t = normalizeClaude(fx('PreToolUse-Agent')).tool!;
    expect(t.canonical).toBe('agent');
    expect(t.subagent).toEqual({ type: 'general-purpose', prompt: 'do it', model: 'sonnet' });
  });

  it('mcp__* -> mcp, unknown -> other', () => {
    const base = fx('PreToolUse-Bash');
    expect(normalizeClaude({ ...base, tool_name: 'mcp__ctk__ctk_find' }).tool!.canonical).toBe('mcp');
    expect(normalizeClaude({ ...base, tool_name: 'WebFetch' }).tool!.canonical).toBe('other');
  });

  it('PreCompact reads trigger (not compaction_reason)', () => {
    expect(normalizeClaude(fx('PreCompact')).trigger).toBe('manual');
  });

  it('SessionEnd reason, Subagent agentType', () => {
    expect(normalizeClaude(fx('SessionEnd')).reason).toBe('clear');
    expect(normalizeClaude(fx('SubagentStop')).agentType).toBe('sdd-apply');
  });

  it('tolerates garbage: missing fields become safe defaults', () => {
    const e = normalizeClaude({ hook_event_name: 'Stop' });
    expect(e.sessionId).toBe('default');
    expect(e.cwd).toBe(process.cwd());
  });
});
