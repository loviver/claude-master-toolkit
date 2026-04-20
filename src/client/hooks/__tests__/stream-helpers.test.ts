import { describe, it, expect } from 'vitest';
import { stableQueryKey, backoffDelay } from '../stream-helpers';

describe('stableQueryKey', () => {
  it('separa segmentos sin colisión', () => {
    expect(stableQueryKey(['sessions', 'foo:bar'])).not.toBe(stableQueryKey(['sessions:foo', 'bar']));
  });

  it('produce misma clave para misma tupla', () => {
    expect(stableQueryKey(['sessions', 'abc'])).toBe(stableQueryKey(['sessions', 'abc']));
  });

  it('diferencia entre undefined y string "undefined"', () => {
    expect(stableQueryKey(['sessions', undefined])).not.toBe(stableQueryKey(['sessions', 'undefined']));
  });

  it('maneja numbers y null sin colisionar con strings', () => {
    expect(stableQueryKey(['k', 1])).not.toBe(stableQueryKey(['k', '1']));
    expect(stableQueryKey(['k', null])).not.toBe(stableQueryKey(['k', 'null']));
  });
});

describe('backoffDelay', () => {
  it('empieza en 1000ms en intento 0', () => {
    expect(backoffDelay(0)).toBe(1000);
  });

  it('duplica por intento', () => {
    expect(backoffDelay(1)).toBe(2000);
    expect(backoffDelay(2)).toBe(4000);
    expect(backoffDelay(3)).toBe(8000);
  });

  it('clampa a 30000ms máximo', () => {
    expect(backoffDelay(10)).toBe(30000);
    expect(backoffDelay(100)).toBe(30000);
  });
});
