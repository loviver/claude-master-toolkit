import type { CodeGraphLinkType } from '../../../lib/types';
import { strongerLink } from '../graph-model';

/**
 * Pure model of the dependency structure matrix (DSM) and the strongly connected
 * components it is built on. Edges read `source → target` = "source uses target".
 */

/**
 * Tarjan's algorithm, iterative so a deep call chain cannot overflow the stack.
 * Components come out callees first (reverse topological order of the condensation).
 */
export function stronglyConnected(ids: readonly string[], edges: ReadonlyArray<readonly [string, string]>): string[][] {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [s, t] of edges) if (out.has(s) && out.has(t)) out.get(s)!.push(t);

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  for (const root of ids) {
    if (index.has(root)) continue;
    const work: Array<{ v: string; next: number }> = [{ v: root, next: 0 }];
    index.set(root, counter); low.set(root, counter); counter++;
    stack.push(root); onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const succ = out.get(frame.v)!;
      if (frame.next < succ.length) {
        const w = succ[frame.next++];
        if (!index.has(w)) {
          index.set(w, counter); low.set(w, counter); counter++;
          stack.push(w); onStack.add(w);
          work.push({ v: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v)!, index.get(w)!));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].v;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.v)!));
      }
      if (low.get(frame.v) === index.get(frame.v)) {
        const comp: string[] = [];
        let w: string;
        do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== frame.v);
        result.push(comp.reverse());
      }
    }
  }
  return result;
}

export interface MatrixLink {
  source: string | { id: string };
  target: string | { id: string };
  type: CodeGraphLinkType;
  weight: number;
}

const endId = (end: string | { id: string }) => (typeof end === 'string' ? end : end.id);

export interface MatrixCell {
  row: number;
  col: number;
  source: string;
  target: string;
  weight: number;
  type: CodeGraphLinkType;
  /** Both ends are in the same cycle: an architectural smell. */
  inCycle: boolean;
}

export interface Matrix {
  /** Row/column order: callees first, so dependencies sit below the diagonal. */
  order: string[];
  cells: MatrixCell[];
  /** Cycles (components of 2+ nodes). */
  cycles: string[][];
}

export function buildMatrix(ids: readonly string[], links: readonly MatrixLink[]): Matrix {
  const known = new Set(ids);
  const pairs = new Map<string, { source: string; target: string; weight: number; type: CodeGraphLinkType }>();
  for (const l of links) {
    const source = endId(l.source);
    const target = endId(l.target);
    if (source === target || !known.has(source) || !known.has(target)) continue;
    const key = `${source}\u0000${target}`;
    const prev = pairs.get(key);
    pairs.set(key, prev
      ? { ...prev, weight: prev.weight + l.weight, type: strongerLink(prev.type, l.type) }
      : { source, target, weight: l.weight, type: l.type });
  }
  const sccs = stronglyConnected(ids, [...pairs.values()].map((p) => [p.source, p.target] as const));
  const order = sccs.flat();
  const position = new Map(order.map((id, i) => [id, i]));
  const compOf = new Map<string, number>();
  sccs.forEach((comp, i) => comp.forEach((id) => compOf.set(id, i)));
  const cells = [...pairs.values()].map((p): MatrixCell => ({
    ...p,
    row: position.get(p.source)!,
    col: position.get(p.target)!,
    inCycle: compOf.get(p.source) === compOf.get(p.target),
  }));
  return { order, cells, cycles: sccs.filter((c) => c.length > 1) };
}
