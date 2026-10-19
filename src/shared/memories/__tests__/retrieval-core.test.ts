import { describe, it, expect } from 'vitest';
import { cosineSimilarity, encodeVector, decodeVector } from '../vector.js';
import { reciprocalRankFusion } from '../fusion.js';
import { canonicalMemoryText } from '../embedding/text.js';
import { sanitizeFtsQuery } from '../search.js';

describe('vector', () => {
  it('cosine of identical vectors is 1', () => {
    const a = Float32Array.from([1, 2, 3]);
    expect(cosineSimilarity(a, Float32Array.from([1, 2, 3]))).toBeCloseTo(1, 6);
  });

  it('cosine of orthogonal vectors is 0', () => {
    expect(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0, 6);
  });

  it('cosine is scale-invariant', () => {
    const a = Float32Array.from([1, 2, 3]);
    const b = Float32Array.from([2, 4, 6]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });

  it('zero-norm vector yields 0 (no NaN)', () => {
    expect(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0);
  });

  it('encode/decode round-trips a Float32Array', () => {
    const v = Float32Array.from([0.5, -1.25, 3.0, 0]);
    const round = decodeVector(encodeVector(v));
    expect(Array.from(round)).toEqual(Array.from(v));
  });
});

describe('reciprocalRankFusion', () => {
  it('fuses two ranked lists, dedups, orders by fused score', () => {
    const fused = reciprocalRankFusion([['A', 'B', 'C'], ['B', 'A', 'D']]);
    const ids = fused.map((f) => f.id);
    expect(ids).toEqual(['A', 'B', 'C', 'D']);
    // A and B tie (both rank1+rank2 across lists); stable insertion order keeps A first
    expect(fused[0]!.score).toBeCloseTo(fused[1]!.score, 9);
    // C beats D only by list-order tie-break (same raw score)
    expect(fused[2]!.id).toBe('C');
  });

  it('single list preserves its order', () => {
    expect(reciprocalRankFusion([['X', 'Y', 'Z']]).map((f) => f.id)).toEqual(['X', 'Y', 'Z']);
  });

  it('empty input yields empty output', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});

describe('canonicalMemoryText', () => {
  it('joins present fields, skips empties', () => {
    const text = canonicalMemoryText({
      title: 'AI credits', what: 'wallet via grant port', why: null, learned: 'FTS brittle', description: null,
    });
    expect(text).toContain('AI credits');
    expect(text).toContain('wallet via grant port');
    expect(text).toContain('FTS brittle');
    expect(text).not.toContain('null');
  });

  it('title-only still produces text', () => {
    expect(canonicalMemoryText({ title: 'solo' })).toBe('solo');
  });
});

describe('sanitizeFtsQuery (OR semantics)', () => {
  it('single term stays a single quoted token', () => {
    expect(sanitizeFtsQuery('alpha')).toBe('"alpha"');
  });

  it('multi term becomes OR of quoted tokens (was AND before)', () => {
    expect(sanitizeFtsQuery('ai credits pricing')).toBe('"ai" OR "credits" OR "pricing"');
  });

  it('escapes embedded double quotes', () => {
    expect(sanitizeFtsQuery('say "hi"')).toBe('"say" OR """hi"""');
  });

  it('empty query yields empty string', () => {
    expect(sanitizeFtsQuery('   ')).toBe('');
  });
});
