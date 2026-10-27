import type { CodeGraphOverlay } from '../CodeGraph3D';
import { STATE_COLORS, impactColor } from '../graph-model';
import type { MatrixLink } from './matrix-model';

/** What the change overlay means for the dependency matrix: which nodes it keeps, how rows and cells read. */

const endId = (end: string | { id: string }) => (typeof end === 'string' ? end : end.id);

/**
 * Review mode narrows the matrix to the diff: changed nodes, their blast radius and impact walk,
 * plus their direct neighbours on demand. Null outside review: the matrix keeps every node.
 */
export function diffSubset(
  ids: readonly string[],
  links: readonly MatrixLink[],
  overlay: CodeGraphOverlay,
  neighbours: boolean,
): Set<string> | null {
  if (!overlay.impact) return null;
  const known = new Set(ids);
  const core = new Set([...overlay.touched, ...overlay.blast, ...overlay.impact.keys()].filter((id) => known.has(id)));
  if (!neighbours) return core;
  const keep = new Set(core);
  for (const l of links) {
    const s = endId(l.source);
    const t = endId(l.target);
    if (core.has(s) && known.has(t)) keep.add(t);
    if (core.has(t) && known.has(s)) keep.add(s);
  }
  return keep;
}

export interface RowPaint {
  /** Label color; null keeps the default foreground. */
  color: string | null;
  /** Some member changed on this branch. */
  touched: boolean;
  /** Off a traced path or the review spotlight. */
  dim: boolean;
}

/** A row's state from its members (one for a leaf, many for a collapsed folder): the strongest wins. */
export function rowPaint(members: readonly string[], overlay: CodeGraphOverlay): RowPaint {
  const touched = members.some((id) => overlay.touched.has(id));
  const dim = overlay.path.size > 0 && !members.some((id) => overlay.path.has(id));
  return { color: rowColor(members, overlay, touched), touched, dim };
}

function rowColor(members: readonly string[], overlay: CodeGraphOverlay, touched: boolean): string | null {
  if (overlay.impact) {
    // Same paint as the canvases' `reviewColor`: git status, then distance from the diff.
    if (members.some((id) => overlay.status.get(id) === 'added')) return STATE_COLORS.added;
    if (members.some((id) => overlay.status.get(id) === 'modified')) return STATE_COLORS.modified;
    if (touched) return STATE_COLORS.touched;
    const hops = Math.min(...members.map((id) => overlay.impact!.get(id) ?? Infinity));
    return Number.isFinite(hops) ? impactColor(hops) : null;
  }
  if (touched) return STATE_COLORS.touched;
  if (members.some((id) => overlay.blast.has(id))) return STATE_COLORS.blast;
  if (members.some((id) => overlay.viewing.has(id))) return STATE_COLORS.viewing;
  if (members.some((id) => overlay.hot.has(id))) return STATE_COLORS.hot;
  return null;
}

export type CellTone = 'changed' | 'affected' | 'dim' | 'normal';

/** A link between two changed rows was (probably) edited; one changed end means the other side is affected. */
export function cellTone(source: RowPaint, target: RowPaint): CellTone {
  if (source.touched && target.touched) return 'changed';
  if (source.touched || target.touched) return 'affected';
  if (source.dim || target.dim) return 'dim';
  return 'normal';
}
