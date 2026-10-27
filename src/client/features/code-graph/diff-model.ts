import type { CodeGraphDiffDTO, CodeGraphDiffLineDTO } from '../../lib/types';

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
