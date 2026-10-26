import { describe, it, expect } from 'vitest';
import { Lru } from '../lru.js';

describe('Lru', () => {
  it('evicts the least recently used entry past capacity', () => {
    const lru = new Lru<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1); // a is now the most recent
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
  });

  it('overwrites an existing key without growing', () => {
    const lru = new Lru<string, number>(1);
    lru.set('a', 1);
    lru.set('a', 2);
    expect(lru.get('a')).toBe(2);
    expect(lru.size).toBe(1);
  });
});
