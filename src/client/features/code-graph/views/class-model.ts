import type { CodeGraphLinkType, CodeGraphNodeDTO } from '../../../lib/types';
import { parseQualifiedId } from '../../../../shared/indexer/ids';

/** Pure model of the class diagram: boxes with their members, inheritance and class-to-class use. */

export interface ClassMember { id: string; name: string; kind: string; signature: string | null; exported: boolean }

export interface ClassBox {
  id: string;
  name: string;
  kind: string;
  file: string | null;
  members: ClassMember[];
}

export interface ClassModel {
  boxes: ClassBox[];
  /** `sub` extends or implements `base`. */
  inherits: Array<{ sub: string; base: string }>;
  /** `from` calls or references `to`, folded across members. */
  uses: Array<{ from: string; to: string; weight: number }>;
}

const BOX_KINDS = new Set(['class', 'interface']);
const endId = (end: string | { id: string }) => (typeof end === 'string' ? end : end.id);

export function buildClassModel(
  nodes: readonly CodeGraphNodeDTO[],
  links: ReadonlyArray<{ source: string | { id: string }; target: string | { id: string }; type: CodeGraphLinkType; weight: number }>,
): ClassModel {
  const boxes = new Map<string, ClassBox>();
  for (const n of nodes) {
    if (BOX_KINDS.has(n.kind)) boxes.set(n.id, { id: n.id, name: n.label, kind: n.kind, file: n.file, members: [] });
  }
  /** The box a node belongs to: itself, or the class owning the `Owner.member` it names. */
  const ownerOf = (id: string): string | null => {
    if (boxes.has(id)) return id;
    const q = parseQualifiedId(id);
    const dot = q ? q.symbol.indexOf('.') : -1;
    if (!q || dot < 0) return null;
    const owner = `${q.file}::${q.symbol.slice(0, dot)}`;
    return boxes.has(owner) ? owner : null;
  };
  for (const n of nodes) {
    if (boxes.has(n.id)) continue;
    const q = parseQualifiedId(n.id);
    const owner = ownerOf(n.id);
    if (!q || !owner) continue;
    const rest = q.symbol.slice(q.symbol.indexOf('.') + 1);
    if (rest.includes('.')) continue;
    boxes.get(owner)!.members.push({ id: n.id, name: rest, kind: n.kind, signature: n.signature, exported: n.exported });
  }

  const inherits: ClassModel['inherits'] = [];
  const uses = new Map<string, { from: string; to: string; weight: number }>();
  for (const l of links) {
    const s = endId(l.source);
    const t = endId(l.target);
    if (l.type === 'inherit') {
      if (boxes.has(s) && boxes.has(t)) inherits.push({ sub: s, base: t });
      continue;
    }
    const from = ownerOf(s);
    const to = ownerOf(t);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}`;
    const prev = uses.get(key);
    uses.set(key, { from, to, weight: (prev?.weight ?? 0) + l.weight });
  }
  return { boxes: [...boxes.values()], inherits, uses: [...uses.values()] };
}
