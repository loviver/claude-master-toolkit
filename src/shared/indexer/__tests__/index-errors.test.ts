import { describe, it, expect } from 'vitest';
import { IndexErrors } from '../index-errors.js';

describe('IndexErrors', () => {
  it('records project-relative file and message, counting every error', () => {
    const errs = new IndexErrors('/proj');
    errs.add('/proj/src/a.ts', new TypeError('boom'));
    errs.add('/proj/src/b.ts', 'plain string failure');
    expect(errs.count).toBe(2);
    expect(errs.report()).toEqual([
      { file: 'src/a.ts', message: 'boom' },
      { file: 'src/b.ts', message: 'plain string failure' },
    ]);
  });

  it('caps the report but keeps the true count', () => {
    const errs = new IndexErrors('/proj', 3);
    for (let i = 0; i < 10; i++) errs.add(`/proj/f${i}.ts`, new Error('x'));
    expect(errs.count).toBe(10);
    expect(errs.report()).toHaveLength(3);
  });

  it('truncates very long messages', () => {
    const errs = new IndexErrors('/proj');
    errs.add('/proj/a.ts', new Error('y'.repeat(500)));
    expect(errs.report()[0]!.message.length).toBeLessThanOrEqual(200);
  });

  it('groups by message so one root cause is visible at a glance', () => {
    const errs = new IndexErrors('/proj');
    errs.add('/proj/a.ts', new Error('same'));
    errs.add('/proj/b.ts', new Error('same'));
    errs.add('/proj/c.ts', new Error('other'));
    expect(errs.byMessage()).toEqual([
      { message: 'same', count: 2 },
      { message: 'other', count: 1 },
    ]);
  });
});
