import type { CodeGraphChangeDTO, CodeGraphDiffDTO, CodeGraphDiffLineDTO } from '../../lib/types';

/** A row of the unified diff: a hunk header (with the unchanged lines it hides) or a line. */
export type DiffRow =
  | { type: 'hunk'; skipped: number; newStart: number; section: string }
  | { type: 'line'; line: CodeGraphDiffLineDTO };

/** Hunks → the flat rows the viewer renders, each hunk led by how many old lines it skips. */
export function diffRows(hunks: CodeGraphDiffDTO['hunks']): DiffRow[] {
  const rows: DiffRow[] = [];
  let nextOld = 1;
  for (const h of hunks) {
    // `-0,0` (a new file) starts at 0: nothing hidden.
    rows.push({ type: 'hunk', skipped: Math.max(0, h.oldStart - nextOld), newStart: h.newStart, section: h.section });
    for (const line of h.lines) {
      rows.push({ type: 'line', line });
      if (line.old !== null) nextOld = line.old + 1;
    }
  }
  return rows;
}

/**
 * Row of the first change at or after new-side line `line` (null: the first change), or -1.
 * A deleted line sits where the new side would be next, so a span's leading deletion counts.
 */
export function firstChangeIndex(rows: DiffRow[], line: number | null): number {
  let cursor = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.type === 'hunk') { cursor = r.newStart - 1; continue; }
    const at = r.line.new ?? cursor + 1;
    if (r.line.new !== null) cursor = r.line.new;
    if (r.line.kind !== 'context' && (line === null || at >= line)) return i;
  }
  return -1;
}

/** Half-open `[start, end)` character spans of a line. */
export type CharRange = [number, number];

const TOKEN = /\w+|\s+|[^\w\s]/g;
/** Token pairs past which the word diff is not worth its quadratic table. */
const MAX_CELLS = 250_000;
/** Below this share of shared non-blank text the lines are rewrites: no word marks. */
const MIN_SHARED = 0.4;

const merge = (ranges: CharRange[]): CharRange[] =>
  ranges.reduce<CharRange[]>((out, r) => {
    const last = out[out.length - 1];
    if (last && last[1] === r[0]) last[1] = r[1];
    else out.push([r[0], r[1]]);
    return out;
  }, []);

/**
 * Word-level diff of a removed line against the added line that replaces it: the spans of
 * each that the other lacks. Backtracks from the end so an insertion groups before the shared tail.
 */
export function wordRanges(a: string, b: string): { del: CharRange[]; add: CharRange[] } {
  const none = { del: [], add: [] };
  const ta = a.match(TOKEN) ?? [];
  const tb = b.match(TOKEN) ?? [];
  if ((ta.length + 1) * (tb.length + 1) > MAX_CELLS) return none;
  const w = tb.length + 1;
  const lcs = new Uint32Array((ta.length + 1) * w);
  for (let i = 1; i <= ta.length; i++) {
    for (let j = 1; j <= tb.length; j++) {
      lcs[i * w + j] = ta[i - 1] === tb[j - 1] ? lcs[(i - 1) * w + j - 1] + 1 : Math.max(lcs[(i - 1) * w + j], lcs[i * w + j - 1]);
    }
  }
  const offsets = (t: string[]) => t.reduce<number[]>((o, tok, k) => (o.push(o[k] + tok.length), o), [0]);
  const oa = offsets(ta);
  const ob = offsets(tb);
  const del: CharRange[] = [];
  const add: CharRange[] = [];
  let shared = 0;
  let i = ta.length;
  let j = tb.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ta[i - 1] === tb[j - 1]) {
      shared += ta[i - 1].trim().length;
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i * w + j - 1] >= lcs[(i - 1) * w + j])) {
      add.push([ob[j - 1], ob[j]]);
      j--;
    } else {
      del.push([oa[i - 1], oa[i]]);
      i--;
    }
  }
  const blank = (s: string) => s.replace(/\s/g, '').length;
  if (shared < MIN_SHARED * Math.max(blank(a), blank(b))) return none;
  return { del: merge(del.reverse()), add: merge(add.reverse()) };
}

/** Word marks per row: the n-th removed line of a block of changes against its n-th added line. */
export function inlineChanges(rows: DiffRow[]): Map<number, CharRange[]> {
  const marks = new Map<number, CharRange[]>();
  let dels: number[] = [];
  let adds: number[] = [];
  const flush = () => {
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const [d, a] = [rows[dels[k]], rows[adds[k]]];
      if (d.type !== 'line' || a.type !== 'line') continue;
      const { del, add } = wordRanges(d.line.text, a.line.text);
      if (del.length) marks.set(dels[k], del);
      if (add.length) marks.set(adds[k], add);
    }
    dels = [];
    adds = [];
  };
  rows.forEach((r, i) => {
    if (r.type === 'line' && r.line.kind === 'del' && adds.length === 0) dels.push(i);
    else if (r.type === 'line' && r.line.kind === 'add') adds.push(i);
    else {
      flush();
      if (r.type === 'line' && r.line.kind === 'del') dels.push(i);
    }
  });
  flush();
  return marks;
}

/** Split a line's highlighted tokens at the edges of `ranges`, flagging the pieces inside. */
export function markTokens<T extends { content: string }>(tokens: T[], ranges: CharRange[]): Array<{ token: T; changed: boolean }> {
  if (ranges.length === 0) return tokens.map((token) => ({ token, changed: false }));
  const out: Array<{ token: T; changed: boolean }> = [];
  let at = 0;
  for (const token of tokens) {
    const end = at + token.content.length;
    const cuts = new Set([at, end]);
    for (const [s, e] of ranges) {
      if (s > at && s < end) cuts.add(s);
      if (e > at && e < end) cuts.add(e);
    }
    const edges = [...cuts].sort((x, y) => x - y);
    for (let k = 0; k < edges.length - 1; k++) {
      const [from, to] = [edges[k], edges[k + 1]];
      const piece = edges.length === 2 ? token : { ...token, content: token.content.slice(from - at, to - at) };
      out.push({ token: piece, changed: ranges.some(([s, e]) => from >= s && to <= e) });
    }
    at = end;
  }
  return out;
}

/** A changed symbol a hunk touches; `declaration` when the diff reaches its first line (signature, props). */
export interface HunkSymbol {
  change: CodeGraphChangeDTO;
  declaration: boolean;
}

/** Per hunk header row, the changed symbols of `file` whose changed spans fall in the hunk. */
export function hunkSymbols(rows: DiffRow[], changes: CodeGraphChangeDTO[], file: string): Map<number, HunkSymbol[]> {
  const own = changes.filter((c) => c.file === file);
  const out = new Map<number, HunkSymbol[]>();
  if (own.length === 0) return out;
  rows.forEach((r, i) => {
    if (r.type !== 'hunk') return;
    let end = r.newStart;
    for (let k = i + 1; k < rows.length; k++) {
      const next = rows[k];
      if (next.type === 'hunk') break;
      if (next.line.new !== null) end = Math.max(end, next.line.new);
    }
    const hits = own
      .filter((c) => c.ranges.some(([s, e]) => s <= end && e >= r.newStart))
      .map((change) => ({ change, declaration: change.ranges.some(([s, e]) => s <= change.startLine && e >= change.startLine) }));
    if (hits.length) out.set(i, hits);
  });
  return out;
}
