import { describe, it, expect } from 'vitest';
import { summarizePrompt } from '../prompt-summary';

describe('summarizePrompt', () => {
  it('passes plain text through untouched', () => {
    expect(summarizePrompt('fix the bug')).toEqual({ text: 'fix the bug', images: 0 });
  });

  it('strips image source placeholders and counts them', () => {
    const r = summarizePrompt('[Image: source: /tmp/a/b/18.png]');
    expect(r).toEqual({ text: '', images: 1 });
  });

  it('strips numbered image refs and keeps surrounding text', () => {
    const r = summarizePrompt('[Image #3] que aplicamos aca [Image #4] ok?');
    expect(r.images).toBe(2);
    expect(r.text).toBe('que aplicamos aca ok?');
  });

  it('does not double count a numbered ref and its source line', () => {
    const r = summarizePrompt('[Image #3] hola [Image: source: /tmp/3.png]');
    expect(r.images).toBe(1);
    expect(r.text).toBe('hola');
  });
});
