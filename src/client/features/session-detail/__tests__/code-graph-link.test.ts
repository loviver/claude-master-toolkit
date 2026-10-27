import { describe, it, expect } from 'vitest';
import { codeGraphHref, sessionTurnHref } from '../code-graph-link';

const params = (href: string) => Object.fromEntries(new URL(href, 'http://x').searchParams);

describe('codeGraphHref', () => {
  it('opens the code graph reviewing the session\'s changes in its project', () => {
    const href = codeGraphHref({ project: '/home/u/my repo', session: 's1' });
    expect(href.startsWith('/code-graph?')).toBe(true);
    expect(params(href)).toEqual({ project: '/home/u/my repo', session: 's1', review: '1' });
  });

  it('can open one file in the editor', () => {
    expect(params(codeGraphHref({ project: '/p', session: 's1', open: 'src/a.ts' })))
      .toMatchObject({ open: 'src/a.ts' });
  });
});

describe('sessionTurnHref', () => {
  it('links back to the session with one turn opened', () => {
    expect(sessionTurnHref('s 1', 42)).toBe('/sessions/s%201?turn=42');
  });
});
