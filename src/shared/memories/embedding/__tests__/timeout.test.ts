import { describe, it, expect } from 'vitest';
import { withTimeout, embedTimeoutMs, DEFAULT_EMBED_TIMEOUT_MS } from '../timeout.js';

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    const r = await withTimeout(Promise.resolve(42), 1000, 'fast');
    expect(r).toBe(42);
  });

  it('rejects when the promise hangs past the budget', async () => {
    const hang = new Promise<number>(() => {}); // never settles
    await expect(withTimeout(hang, 20, 'hang')).rejects.toThrow(/timed out after 20ms/);
  });

  it('propagates the underlying rejection unchanged', async () => {
    const boom = Promise.reject(new Error('boom'));
    await expect(withTimeout(boom, 1000, 'err')).rejects.toThrow('boom');
  });
});

describe('embedTimeoutMs', () => {
  it('defaults when env is unset/invalid', () => {
    const old = process.env['CTK_EMBED_TIMEOUT_MS'];
    delete process.env['CTK_EMBED_TIMEOUT_MS'];
    expect(embedTimeoutMs()).toBe(DEFAULT_EMBED_TIMEOUT_MS);
    process.env['CTK_EMBED_TIMEOUT_MS'] = 'nope';
    expect(embedTimeoutMs()).toBe(DEFAULT_EMBED_TIMEOUT_MS);
    if (old === undefined) delete process.env['CTK_EMBED_TIMEOUT_MS'];
    else process.env['CTK_EMBED_TIMEOUT_MS'] = old;
  });

  it('honors a valid override', () => {
    const old = process.env['CTK_EMBED_TIMEOUT_MS'];
    process.env['CTK_EMBED_TIMEOUT_MS'] = '1234';
    expect(embedTimeoutMs()).toBe(1234);
    if (old === undefined) delete process.env['CTK_EMBED_TIMEOUT_MS'];
    else process.env['CTK_EMBED_TIMEOUT_MS'] = old;
  });
});
