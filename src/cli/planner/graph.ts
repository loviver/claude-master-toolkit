export type ComponentID = string;

export interface ResolvedPlan {
  orderedComponents: ComponentID[];
  addedDependencies: ComponentID[];
}

interface SoftPair {
  before: ComponentID;
  after: ComponentID;
}

export class Graph {
  private hard = new Map<ComponentID, ComponentID[]>();
  private soft: SoftPair[] = [];

  add(id: ComponentID, deps: ComponentID[]): void {
    this.hard.set(id, deps);
  }

  deps(id: ComponentID): ComponentID[] {
    return this.hard.get(id) ?? [];
  }

  has(id: ComponentID): boolean {
    return this.hard.has(id);
  }

  /** Declare that `before` must run before `after` *iff* both are selected. */
  addSoftOrder(before: ComponentID, after: ComponentID): void {
    this.soft.push({ before, after });
  }

  softPairs(): SoftPair[] {
    return [...this.soft];
  }
}

export class Resolver {
  constructor(private graph: Graph) {}

  resolve(selection: ComponentID[]): ResolvedPlan {
    const selectedSet = new Set(selection);
    for (const id of selection) {
      if (!this.graph.has(id)) {
        throw new Error(`unknown component: ${id}`);
      }
    }

    // Walk dep closure
    const closure = new Set<ComponentID>();
    const walk = (id: ComponentID): void => {
      if (closure.has(id)) return;
      closure.add(id);
      for (const dep of this.graph.deps(id)) walk(dep);
    };
    for (const id of selection) walk(id);

    // Build adjacency list (dep → dependents) for Kahn's
    const hardEdges = new Map<ComponentID, Set<ComponentID>>();
    const indegree = new Map<ComponentID, number>();
    for (const id of closure) indegree.set(id, 0);

    const addEdge = (from: ComponentID, to: ComponentID): void => {
      if (!closure.has(from) || !closure.has(to)) return;
      if (!hardEdges.has(from)) hardEdges.set(from, new Set());
      const set = hardEdges.get(from)!;
      if (set.has(to)) return;
      set.add(to);
      indegree.set(to, (indegree.get(to) ?? 0) + 1);
    };

    for (const id of closure) {
      for (const dep of this.graph.deps(id)) addEdge(dep, id);
    }
    for (const { before, after } of this.graph.softPairs()) {
      if (closure.has(before) && closure.has(after)) addEdge(before, after);
    }

    // Kahn topological sort
    const ordered: ComponentID[] = [];
    const ready: ComponentID[] = [];
    for (const [id, deg] of indegree) if (deg === 0) ready.push(id);
    ready.sort();

    while (ready.length > 0) {
      const id = ready.shift()!;
      ordered.push(id);
      for (const next of hardEdges.get(id) ?? []) {
        const newDeg = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, newDeg);
        if (newDeg === 0) {
          ready.push(next);
          ready.sort();
        }
      }
    }

    if (ordered.length !== closure.size) {
      throw new Error('cycle detected in dependency graph');
    }

    return {
      orderedComponents: ordered,
      addedDependencies: ordered.filter((id) => !selectedSet.has(id)),
    };
  }
}
