import type { CodeGraphChangeDTO, CodeGraphChangedFileDTO } from '../../lib/types';

/** One changed file as the review tree shows it: its changed symbols and the lines no symbol owns. */
export interface ChangedFileNode {
  file: string;
  added: number;
  removed: number;
  /** Changed spans outside every indexed symbol (imports, top-level code). */
  outside: Array<[number, number]>;
  /** Changed symbols in reading order. */
  symbols: CodeGraphChangeDTO[];
  /** Distinct untouched callers of the file's changed symbols: the file's impact. */
  callers: number;
}

/** The diff as one file → symbol tree; files with the widest impact first. */
export function changesTree(changes: CodeGraphChangeDTO[], files: CodeGraphChangedFileDTO[]): ChangedFileNode[] {
  const byFile = new Map<string, CodeGraphChangeDTO[]>();
  for (const c of changes) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  return files
    .map((f) => {
      const symbols = [...(byFile.get(f.file) ?? [])].sort((a, b) => a.startLine - b.startLine || a.id.localeCompare(b.id));
      return {
        file: f.file,
        added: f.added,
        removed: f.removed,
        outside: f.outside,
        symbols,
        callers: new Set(symbols.flatMap((s) => s.callers)).size,
      };
    })
    .sort((a, b) => b.callers - a.callers || a.file.localeCompare(b.file));
}

/** The diff narrowed to `only` (a session's files); null keeps all of it. */
export function restrictToFiles(
  changes: CodeGraphChangeDTO[],
  files: CodeGraphChangedFileDTO[],
  only: ReadonlySet<string> | null,
): { changes: CodeGraphChangeDTO[]; files: CodeGraphChangedFileDTO[] } {
  if (!only) return { changes, files };
  return { changes: changes.filter((c) => only.has(c.file)), files: files.filter((f) => only.has(f.file)) };
}

/**
 * The review row matching what is being viewed: the changed symbol if it is one,
 * else the open file's row, else nothing (the viewed code is outside the diff).
 */
export function activeChange(
  tree: ChangedFileNode[],
  file: string | null,
  symbolId: string | null,
): { file: string; symbol: string | null } | null {
  if (symbolId) {
    const owner = tree.find((f) => f.symbols.some((s) => s.id === symbolId));
    if (owner) return { file: owner.file, symbol: symbolId };
  }
  return file && tree.some((f) => f.file === file) ? { file, symbol: null } : null;
}

/** `L4, L10–12`: changed spans as a reviewer reads them; past `max`, the rest is a count. */
export function formatSpans(spans: ReadonlyArray<readonly [number, number]>, max = 3): string {
  const shown = spans.slice(0, max).map(([s, e]) => (s === e ? `L${s}` : `L${s}–${e}`)).join(', ');
  return spans.length > max ? `${shown} +${spans.length - max}` : shown;
}

/** The file's impact badge: `—` when no indexed symbol covers its changes (unknown, not zero). */
export function impactBadge(node: ChangedFileNode): string {
  return node.symbols.length === 0 ? '—' : String(node.callers);
}
