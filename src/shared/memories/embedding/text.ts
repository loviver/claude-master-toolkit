/**
 * Canonical text for embedding a memory. Concatenates the human-meaningful fields in a
 * fixed order so the same memory always produces the same input vector. Empty/null fields
 * are skipped (no literal "null" leaking into the embedding).
 */

export interface EmbeddableMemory {
  title: string;
  what?: string | null;
  why?: string | null;
  learned?: string | null;
  description?: string | null;
}

export function canonicalMemoryText(m: EmbeddableMemory): string {
  return [m.title, m.what, m.why, m.learned, m.description]
    .map((f) => (f ?? '').trim())
    .filter((f) => f.length > 0)
    .join('\n');
}
