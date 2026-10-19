/**
 * Dense-vector primitives for Pandorica hybrid recall.
 *
 * Vectors are persisted as raw little-endian Float32 BLOBs in `memory_embeddings.vector`.
 * At personal-vault scale (hundreds–thousands of memories) brute-force cosine in JS is
 * sub-millisecond, so there is no native vector extension — just these pure helpers.
 */

/** Cosine similarity in [-1, 1]. Returns 0 for a zero-norm operand (never NaN). */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Pack a Float32Array into a little-endian Float32 Buffer for BLOB storage. */
export function encodeVector(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/** Decode a BLOB back into a Float32Array (copying, so it is independent of the source buffer). */
export function decodeVector(buf: Buffer | Uint8Array): Float32Array {
  const copy = Uint8Array.prototype.slice.call(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4));
}
