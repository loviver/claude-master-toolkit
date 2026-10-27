/**
 * Pure model of IDE-style code navigation: back/forward history, the structure tree,
 * and resolving a Ctrl+clicked identifier to its declaration off the symbol index.
 * The index knows which symbols a symbol calls and on which lines, not where each
 * identifier points, so resolution matches the clicked name against those neighbours.
 */
import type { CodeGraphLevel, CodeGraphOutlineDTO, CodeGraphSymbolDTO, CodeGraphSymbolRefDTO } from '../../lib/types';
import { nodeIdForFile } from './explorer-model';

/** A place in a file: what back/forward returns to. */
export interface NavLocation {
  file: string;
  range: [number, number] | null;
}

export interface NavHistory {
  back: NavLocation[];
  forward: NavLocation[];
}

export const HISTORY_MAX = 50;
export const emptyHistory: NavHistory = { back: [], forward: [] };

const samePlace = (a: NavLocation | undefined, b: NavLocation) =>
  !!a && a.file === b.file && a.range?.[0] === b.range?.[0];

/** Record leaving `from` for somewhere new: it becomes the way back, and forward is dropped. */
export function pushHistory(history: NavHistory, from: NavLocation | null): NavHistory {
  if (!from || samePlace(history.back.at(-1), from)) return { ...history, forward: [] };
  return { back: [...history.back, from].slice(-HISTORY_MAX), forward: [] };
}

export function goBack(history: NavHistory, current: NavLocation | null): { history: NavHistory; target: NavLocation } | null {
  const target = history.back.at(-1);
  if (!target) return null;
  return {
    history: { back: history.back.slice(0, -1), forward: current ? [...history.forward, current] : history.forward },
    target,
  };
}

export function goForward(history: NavHistory, current: NavLocation | null): { history: NavHistory; target: NavLocation } | null {
  const target = history.forward.at(-1);
  if (!target) return null;
  return {
    history: { back: current ? [...history.back, current] : history.back, forward: history.forward.slice(0, -1) },
    target,
  };
}

export interface OutlineNode {
  item: CodeGraphOutlineDTO;
  children: OutlineNode[];
}

const contains = (outer: CodeGraphOutlineDTO, inner: CodeGraphOutlineDTO) =>
  outer.startLine <= inner.startLine && inner.endLine <= outer.endLine;

/** The structure view's tree: each symbol under the narrowest symbol whose span holds it. */
export function outlineTree(outline: readonly CodeGraphOutlineDTO[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  const sorted = [...outline].sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  for (const item of sorted) {
    const node: OutlineNode = { item, children: [] };
    while (stack.length > 0 && !contains(stack.at(-1)!.item, item)) stack.pop();
    (stack.at(-1)?.children ?? roots).push(node);
    stack.push(node);
  }
  return roots;
}

/** The narrowest symbol around `line`, as VSCode's breadcrumb picks it. */
export function innermostAt(outline: readonly CodeGraphOutlineDTO[], line: number): CodeGraphOutlineDTO | undefined {
  return outline
    .filter((s) => s.startLine <= line && s.endLine >= line)
    .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];
}

/** The graph node the caret sits in: the symbol around `line` at symbol level, else the file's node. */
export function nodeForCaret(
  level: CodeGraphLevel,
  file: string,
  outline: readonly CodeGraphOutlineDTO[],
  line: number,
): string | null {
  return level === 'symbol' ? innermostAt(outline, line)?.id ?? null : nodeIdForFile(level, file);
}

const IDENT = /[A-Za-z_$][\w$]*/g;

/** Splits highlighted text into identifier and non-identifier runs, so each name can be Ctrl+clicked. */
export function splitIdentifiers(text: string): Array<{ text: string; ident: boolean }> {
  const parts: Array<{ text: string; ident: boolean }> = [];
  let last = 0;
  for (const m of text.matchAll(IDENT)) {
    // `1px`, `0x1f`: a name glued to a digit is part of a number, not an identifier.
    if (m.index > 0 && /\d/.test(text[m.index - 1])) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index), ident: false });
    parts.push({ text: m[0], ident: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), ident: false });
  return parts;
}

export const memberName = (symbol: string) => symbol.slice(symbol.lastIndexOf('.') + 1);

/** A symbol a clicked name may point to, with what the index says about where it is used from here. */
export interface DeclarationCandidate extends CodeGraphSymbolRefDTO {
  /** Lines of the enclosing symbol that call it; empty when unknown. */
  lines: number[];
  dispatch: boolean;
}

/** What a name inside `enclosing` can resolve to: what it calls and names, then the file's own symbols. */
export function declarationCandidates(
  enclosing: CodeGraphSymbolDTO | undefined,
  outline: readonly CodeGraphOutlineDTO[],
  file: string,
): DeclarationCandidate[] {
  const plain = (r: CodeGraphSymbolRefDTO): DeclarationCandidate => ({ ...r, lines: [], dispatch: false });
  return [
    ...(enclosing?.callees ?? []).map((c) => ({ ...c, dispatch: !!c.dispatch })),
    ...[...(enclosing?.references ?? []), ...(enclosing?.supertypes ?? []), ...(enclosing?.members ?? [])].map(plain),
    ...outline.map((s) => plain({ ...s, file })),
  ];
}

/**
 * The declarations a Ctrl+click on `name` at `line` most likely means: a call on that line
 * first, a direct call before an override it may dispatch to, then any neighbour by name.
 * Returns every candidate of the best rank (more than one: let the user choose).
 */
export function resolveIdentifier(name: string, line: number, candidates: readonly DeclarationCandidate[]): DeclarationCandidate[] {
  const scored = new Map<string, [DeclarationCandidate, number]>();
  for (const c of candidates) {
    if (memberName(c.symbol) !== name && c.symbol !== name) continue;
    const score = (c.lines.includes(line) ? 0 : 2) + (c.dispatch ? 1 : 0);
    const known = scored.get(c.id);
    if (!known || score < known[1]) scored.set(c.id, [c, score]);
  }
  const best = Math.min(...[...scored.values()].map(([, s]) => s));
  return [...scored.values()].filter(([, s]) => s === best).map(([c]) => c);
}

/** IntelliJ's Search Everywhere: two Shift presses within this window. */
export const DOUBLE_SHIFT_MS = 400;

export function isDoubleShift(lastShiftAt: number | null, now: number): boolean {
  return lastShiftAt !== null && now - lastShiftAt <= DOUBLE_SHIFT_MS;
}

const ICONS: Record<string, string> = {
  class: 'symbol-class',
  interface: 'symbol-interface',
  type: 'symbol-type-parameter',
  enum: 'symbol-enum',
  function: 'symbol-method',
  method: 'symbol-method',
  const: 'symbol-variable',
  struct: 'symbol-struct',
  module: 'symbol-namespace',
  file: 'file-code',
};

/** The codicon VSCode shows for a symbol kind. */
export function symbolIcon(kind: string): string {
  return ICONS[kind] ?? 'symbol-misc';
}
