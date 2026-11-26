import type { RiskReason } from './types.js';
import type { TouchedRange } from './diff.js';
import type { TouchedSymbol } from './map.js';

/**
 * Render a structured risk reason as a one-line English string. Presentation
 * lives here, not in the scorer — a Spanish (or any other) formatter is just a
 * sibling of this function; the domain emits `RiskReason` codes untouched.
 */
export function formatReason(reason: RiskReason): string {
  switch (reason.code) {
    case 'scored':
      return `score ${reason.score.toFixed(2)} → ${reason.tier}`;
    case 'dominant':
      return `dominant signal: ${reason.signal} (${reason.value})`;
    case 'hotSymbolFloor':
      return `a symbol with ${reason.callers} callers floors the tier at ${reason.floor} (${reason.from} → ${reason.to})`;
    case 'priorBugEscalation':
      return `${reason.count} prior bug finding(s) on touched code → +1 tier (${reason.from} → ${reason.to})`;
  }
}

/** Convenience: format a whole rationale into lines. */
export function formatRationale(reasons: RiskReason[]): string[] {
  return reasons.map(formatReason);
}

// Extensions the AST index covers (ts-indexer + tree-sitter-indexer).
const INDEXED_FILE = /\.(tsx?|jsx?|mjs|cjs|py|go|rs)$/;

export interface RiskNotesInput {
  base: string;
  ranges: TouchedRange[];
  touched: TouchedSymbol[];
  worktree: boolean;
  /** Whether the AST index holds any symbol for this project. */
  indexed: boolean;
}

/**
 * Caveats a reader needs before trusting a low score: a 0.00 over an empty diff
 * measured nothing, and changed lines that map to no symbol point to a stale index.
 */
export function riskNotes({ base, ranges, touched, worktree, indexed }: RiskNotesInput): string[] {
  if (ranges.length === 0) {
    return [
      worktree
        ? `No changes vs ${base}`
        : `No changes vs ${base} (committed only; drop --committed to include uncommitted edits)`,
    ];
  }
  if (!indexed) return ['project is not indexed: only diff size was measured (run `ctk index build`)'];
  const sourceFiles = new Set(ranges.map((r) => r.file).filter((f) => INDEXED_FILE.test(f)));
  if (touched.length === 0 && sourceFiles.size > 0) {
    const files = sourceFiles.size;
    return [`${files} file(s) changed but 0 indexed symbols touched: the index may be stale (run \`ctk index build\`)`];
  }
  return [];
}
