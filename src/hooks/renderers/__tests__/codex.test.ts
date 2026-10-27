import { describe, it, expect } from 'vitest';
import { renderCodex } from '../codex.js';
import { result } from '../../runtime/dispatch.js';

const json = (o: { stdout: string }) => JSON.parse(o.stdout);

describe('renderCodex (contract: official hooks doc)', () => {
  it('nothing => silent', () => {
    expect(renderCodex('PreToolUse', [])).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  });

  describe('block', () => {
    it('PreToolUse => exit 2 + stderr', () => {
      expect(renderCodex('PreToolUse', [result.block('nope')])).toEqual({ stdout: '', stderr: 'nope\n', exitCode: 2 });
    });
    it('Stop => exit 2 + stderr (Codex starts a continuation prompt with the reason)', () => {
      expect(renderCodex('Stop', [result.block('keep going')])).toEqual({ stdout: '', stderr: 'keep going\n', exitCode: 2 });
    });
    it('UserPromptSubmit => JSON decision block on stdout, exit 0', () => {
      const o = renderCodex('UserPromptSubmit', [result.block('dirty git')]);
      expect(o.exitCode).toBe(0);
      expect(json(o)).toEqual({ decision: 'block', reason: 'dirty git' });
    });
  });

  describe('ask (unsupported by Codex: parsed, hook marked failed, call continues)', () => {
    it('degrades to non-blocking additionalContext, never emits permissionDecision ask', () => {
      const o = renderCodex('PreToolUse', [result.ask('sure?')]);
      expect(o.exitCode).toBe(0);
      const j = json(o);
      expect(j.hookSpecificOutput.hookEventName).toBe('PreToolUse');
      expect(j.hookSpecificOutput.additionalContext).toContain('sure?');
      expect(j.hookSpecificOutput.permissionDecision).toBeUndefined();
    });
  });

  describe('context', () => {
    it.each(['SessionStart', 'UserPromptSubmit', 'SubagentStart'] as const)('%s => plain stdout', (ev) => {
      expect(renderCodex(ev, [result.context('hello')])).toEqual({ stdout: 'hello\n', stderr: '', exitCode: 0 });
    });
    it('PreToolUse => hookSpecificOutput.additionalContext WITHOUT permissionDecision (allow needs updatedInput)', () => {
      expect(json(renderCodex('PreToolUse', [result.context('hint')]))).toEqual({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'hint' },
      });
    });
    it('PostToolUse => JSON additionalContext (plain stdout is ignored there)', () => {
      expect(json(renderCodex('PostToolUse', [result.context('c')]))).toEqual({
        hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'c' },
      });
    });
    it('PreCompact / SessionEnd: no additionalContext support => dropped', () => {
      expect(renderCodex('PreCompact', [result.context('x')])).toEqual({ stdout: '', stderr: '', exitCode: 0 });
      expect(renderCodex('SessionEnd', [result.context('x')])).toEqual({ stdout: '', stderr: '', exitCode: 0 });
    });
    it('Stop context => systemMessage JSON (Stop rejects plain stdout)', () => {
      expect(json(renderCodex('Stop', [result.context('c')]))).toEqual({ systemMessage: 'c' });
    });
  });

  describe('message', () => {
    it('Stop => single JSON object on stdout (plain text is invalid for Stop)', () => {
      const o = renderCodex('Stop', [result.message('hint')]);
      expect(o).toEqual({ stdout: JSON.stringify({ systemMessage: 'hint' }) + '\n', stderr: '', exitCode: 0 });
    });
    it('PreCompact => systemMessage', () => {
      expect(json(renderCodex('PreCompact', [result.message('m')]))).toEqual({ systemMessage: 'm' });
    });
    it('context + message on a JSON event merge into ONE object', () => {
      const o = renderCodex('PostToolUse', [result.context('c'), result.message('m')]);
      expect(o.stdout.trim().split('\n')).toHaveLength(1);
      expect(json(o)).toEqual({ systemMessage: 'm', hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'c' } });
    });
    it('plain-stdout event with context + message keeps stdout plain (message appended)', () => {
      const o = renderCodex('SessionStart', [result.context('c'), result.message('m')]);
      expect(o.stdout).toBe('c\nm\n');
    });
  });
});
