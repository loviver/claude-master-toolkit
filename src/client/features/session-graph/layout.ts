export interface LayoutDims {
  colW: number;
  rowH: number;
}

/**
 * Top-down tree layout: depth grows downward (y), sibling branches take side lanes (x).
 * The timeline reads like a git log; nodes' Top/Bottom handles line up with it.
 */
export function layoutTree(
  roots: string[],
  childrenByParent: Map<string, string[]>,
  { colW, rowH }: LayoutDims,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  let lane = 0;
  // Iterative over the main chain so a long session can't blow the stack.
  const walk = (start: string, startDepth: number): void => {
    const startLane = lane;
    const chain: Array<{ id: string; depth: number }> = [];
    let id: string | undefined = start;
    let depth = startDepth;
    while (id) {
      chain.push({ id, depth });
      const kids: string[] = childrenByParent.get(id) ?? [];
      const [main, ...branches] = kids;
      for (const b of branches) {
        lane++;
        walk(b, depth + 1);
      }
      id = main;
      depth++;
    }
    for (const c of chain) positions.set(c.id, { x: startLane * colW, y: c.depth * rowH });
  };
  for (const r of roots) {
    walk(r, 0);
    lane++;
  }
  return positions;
}
