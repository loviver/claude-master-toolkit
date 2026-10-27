import { describe, it, expect } from 'vitest';
import { renderClaude } from '../claude-code.js';
import { result } from '../../runtime/dispatch.js';

describe('renderClaude', () => {
  it('no results -> empty, exit 0', () => {
    expect(renderClaude('PreToolUse', [])).toEqual({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('block -> stderr + exit 2', () => {
    expect(renderClaude('PreToolUse', [result.block('nope')])).toEqual({
      stdout: '',
      stderr: 'nope\n',
      exitCode: 2,
    });
  });

  it('ask on PreToolUse -> permissionDecision ask', () => {
    const o = renderClaude('PreToolUse', [result.ask('sure?')]);
    expect(o.exitCode).toBe(0);
    expect(JSON.parse(o.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'sure?' },
    });
  });

  it('context on PreToolUse -> allow + additionalContext', () => {
    expect(JSON.parse(renderClaude('PreToolUse', [result.context('hint')]).stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext: 'hint' },
    });
  });

  it.each(['SubagentStart', 'SubagentStop', 'PostToolUse'] as const)('context on %s -> additionalContext', (ev) => {
    expect(JSON.parse(renderClaude(ev, [result.context('c')]).stdout)).toEqual({
      hookSpecificOutput: { hookEventName: ev, additionalContext: 'c' },
    });
  });

  it.each(['SessionStart', 'UserPromptSubmit'] as const)('context on %s -> plain stdout', (ev) => {
    expect(renderClaude(ev, [result.context('plain text')])).toEqual({
      stdout: 'plain text\n',
      stderr: '',
      exitCode: 0,
    });
  });

  it('message on PreCompact -> systemMessage JSON', () => {
    expect(JSON.parse(renderClaude('PreCompact', [result.message('careful')]).stdout)).toEqual({
      systemMessage: 'careful',
    });
  });

  it('message on Stop -> stderr (visible hint), exit 0', () => {
    expect(renderClaude('Stop', [result.message('hint')])).toEqual({ stdout: '', stderr: 'hint\n', exitCode: 0 });
  });

  it('block on UserPromptSubmit -> stderr + exit 2', () => {
    expect(renderClaude('UserPromptSubmit', [result.block('dirty')]).exitCode).toBe(2);
  });
});
