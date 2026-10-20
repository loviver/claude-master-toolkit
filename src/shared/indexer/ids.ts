/**
 * Canonical identity for a symbol edge in the AST index: `file::symbol`.
 *
 * Bare symbol names collide across files (two `run`s, two `helper`s). Qualifying
 * an edge with the project-relative file of its target makes dep/caller lookups
 * and the risk blast-radius collision-proof. Methods already use `.`
 * (`Svc.doThing`), so `::` is used as the file/symbol separator to avoid clashing.
 */
const SEP = '::';

export function qualifyId(file: string, symbol: string): string {
  return `${file}${SEP}${symbol}`;
}

/**
 * Parse a qualified id back into its parts. Splits on the FIRST `::` so a symbol
 * that happens to contain `::` (it won't in practice, but be safe) stays intact.
 * Returns `null` for a bare, unqualified id — the honest signal for an edge the
 * resolver could not attribute to a file (dynamic / `any` dispatch fallback).
 */
export function parseQualifiedId(id: string): { file: string; symbol: string } | null {
  const idx = id.indexOf(SEP);
  if (idx < 0) return null;
  return { file: id.slice(0, idx), symbol: id.slice(idx + SEP.length) };
}
