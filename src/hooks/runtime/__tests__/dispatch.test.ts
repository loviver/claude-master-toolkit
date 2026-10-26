import { describe, it, expect } from 'vitest';
import { combineResults, dispatch, result } from '../dispatch.js';
import type { HookEvent, HookHandler } from '../types.js';

const ev = (over: Partial<HookEvent> = {}): HookEvent => ({
  agent: 'claude-code',
  event: 'PreToolUse',
  sessionId: 's1',
  cwd: '/tmp/x',
  raw: {},
  ...over,
});

describe('combineResults', () => {
  it('drops noops and returns [] when nothing remains', () => {
    expect(combineResults([result.noop(), result.noop()])).toEqual([]);
  });

  it('block wins over everything else', () => {
    const out = combineResults([result.context('a'), result.block('no'), result.ask('hm')]);
    expect(out).toEqual([result.block('no')]);
  });

  it('first block wins when several', () => {
    expect(combineResults([result.block('one'), result.block('two')])).toEqual([result.block('one')]);
  });

  it('ask wins over context/message', () => {
    expect(combineResults([result.context('a'), result.ask('q')])).toEqual([result.ask('q')]);
  });

  it('concatenates contexts and messages separately', () => {
    const out = combineResults([
      result.context('a'),
      result.message('m1'),
      result.context('b'),
      result.message('m2'),
    ]);
    expect(out).toEqual([result.context('a\n\nb'), result.message('m1\n\nm2')]);
  });
});

describe('dispatch', () => {
  it('runs every handler registered for the event and combines', async () => {
    const h1: HookHandler = () => result.context('one');
    const h2: HookHandler = async () => result.context('two');
    const out = await dispatch(ev(), { PreToolUse: [h1, h2] });
    expect(out).toEqual([result.context('one\n\ntwo')]);
  });

  it('returns [] for an event with no handlers', async () => {
    expect(await dispatch(ev({ event: 'Stop' }), { PreToolUse: [() => result.block('x')] })).toEqual([]);
  });

  it('a throwing handler is treated as noop and does not stop the others', async () => {
    const bad: HookHandler = () => {
      throw new Error('boom');
    };
    const good: HookHandler = () => result.context('ok');
    expect(await dispatch(ev(), { PreToolUse: [bad, good] })).toEqual([result.context('ok')]);
  });
});
