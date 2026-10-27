import { describe, it, expect } from 'vitest';
import { parseChurnLog } from '../churn.js';

describe('parseChurnLog', () => {
  it('counts commits per file from `git log --name-only --format=`', () => {
    const out = ['', 'src/a.ts', 'src/b.ts', '', 'src/a.ts', '', ''].join('\n');
    expect(parseChurnLog(out)).toEqual(new Map([['src/a.ts', 2], ['src/b.ts', 1]]));
  });

  it('strips a path prefix so counts line up with project-relative index paths', () => {
    const out = 'pkg/app/src/a.ts\nother/x.ts\n';
    expect(parseChurnLog(out, 'pkg/app/')).toEqual(new Map([['src/a.ts', 1]]));
  });

  it('an empty log is an empty map', () => {
    expect(parseChurnLog('')).toEqual(new Map());
  });
});
