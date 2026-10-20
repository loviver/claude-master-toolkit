import { describe, it, expect } from 'vitest';
import { qualifyId, parseQualifiedId } from '../ids.js';

describe('qualified symbol ids', () => {
  it('joins file and symbol with ::', () => {
    expect(qualifyId('src/a.ts', 'foo')).toBe('src/a.ts::foo');
  });

  it('round-trips a qualified id', () => {
    const id = qualifyId('src/shared/risk/map.ts', 'rangesOverlap');
    expect(parseQualifiedId(id)).toEqual({
      file: 'src/shared/risk/map.ts',
      symbol: 'rangesOverlap',
    });
  });

  it('preserves a method symbol that itself contains a dot', () => {
    const id = qualifyId('src/svc.ts', 'Svc.doThing');
    expect(parseQualifiedId(id)).toEqual({ file: 'src/svc.ts', symbol: 'Svc.doThing' });
  });

  it('splits on the first :: only (paths never contain ::, symbols might not either)', () => {
    expect(parseQualifiedId('a/b.ts::foo')).toEqual({ file: 'a/b.ts', symbol: 'foo' });
  });

  it('returns null for a bare (unqualified) id', () => {
    expect(parseQualifiedId('foo')).toBeNull();
  });
});
