import { describe, it, expect } from 'vitest';
import { taskGuard } from '../task-guard.js';

describe('taskGuard', () => {
  it('non /task prompt => noop, no task', () => {
    expect(taskGuard('hello', { gitDirty: true })).toEqual({ result: { kind: 'noop' } });
  });

  it('/task with dirty git => block', () => {
    const o = taskGuard('/task fix-auth', { gitDirty: true });
    expect(o.result.kind).toBe('block');
    expect(o.task).toBeUndefined();
  });

  it('/task with clean git => persists task name + confirmation', () => {
    const o = taskGuard('/task  fix-auth  ', { gitDirty: false });
    expect(o.task).toBe('fix-auth');
    expect(o.result).toEqual({ kind: 'context', text: '✓ Task: fix-auth' });
  });

  it('/task without a name => noop', () => {
    expect(taskGuard('/task', { gitDirty: false })).toEqual({ result: { kind: 'noop' } });
  });
});
