/**
 * Reciprocal Rank Fusion (RRF) — the standard parameter-light way to merge several
 * ranked result lists (here: FTS5 keyword rank + dense-vector cosine rank) into one.
 *
 * score(id) = Σ_lists 1 / (k + rank)   with rank 1-based within each list.
 * k=60 is the canonical default from the original RRF paper.
 */

export interface FusedHit {
  id: string;
  score: number;
}

export function reciprocalRankFusion(lists: string[][], k = 60): FusedHit[] {
  const scores = new Map<string, number>();
  const order: string[] = []; // first-appearance order → stable tie-break

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank]!;
      if (!scores.has(id)) order.push(id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    }
  }

  // Stable sort (ES2019+) by score desc; ties keep first-appearance order.
  return order
    .map((id) => ({ id, score: scores.get(id)! }))
    .sort((a, b) => b.score - a.score);
}
