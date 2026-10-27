import { describe, it, expect } from 'vitest';
import { layoutTree } from '../layout';

const DIMS = { colW: 300, rowH: 200 };

describe('layoutTree', () => {
  it('stacks a linear chain vertically in a single lane', () => {
    const children = new Map([['a', ['b']], ['b', ['c']]]);
    const pos = layoutTree(['a'], children, DIMS);
    expect(pos.get('a')).toEqual({ x: 0, y: 0 });
    expect(pos.get('b')).toEqual({ x: 0, y: 200 });
    expect(pos.get('c')).toEqual({ x: 0, y: 400 });
  });

  it('spreads branches into side lanes at the same depth', () => {
    const children = new Map([['a', ['main', 'side']]]);
    const pos = layoutTree(['a'], children, DIMS);
    expect(pos.get('main')).toEqual({ x: 0, y: 200 });
    expect(pos.get('side')).toEqual({ x: 300, y: 200 });
    expect(pos.get('a')!.y).toBe(0);
  });

  it('keeps the main chain on lane 0 when a branch rejoins later', () => {
    const children = new Map([['a', ['b', 's']], ['b', ['c']]]);
    const pos = layoutTree(['a'], children, DIMS);
    expect(pos.get('a')!.x).toBe(0);
    expect(pos.get('c')).toEqual({ x: 0, y: 400 });
  });
});
