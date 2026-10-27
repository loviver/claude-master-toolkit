import type Database from 'better-sqlite3';
import type { TouchedRange } from './diff.js';

/** A symbol the diff touches, with the data the scorer needs off the index. */
export interface TouchedSymbol {
  file: string;
  symbol: string;
  exported: boolean;
  /** Names of symbols that call this one (1-hop callers), from the AST index. */
  callers: string[];
  /** What this symbol uses (1-hop deps), from the AST index. */
  deps: string[];
  range: [number, number];
}

/** Inclusive-on-both-edges overlap of two [start,end] line spans. */
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

interface SymbolRow {
  symbol: string;
  start_line: number;
  end_line: number;
  exported: number;
  callers: string | null;
  deps: string | null;
}

/**
 * Map touched ranges to the symbols they overlap, using the AST `symbols` table.
 * The `db` is injected (callers open/close it) so this stays a thin, testable
 * adapter. Ranges are grouped by file so a symbol is returned once even if
 * several hunks hit it.
 */
export function mapTouchedSymbols(
  db: Database.Database,
  projectPath: string,
  ranges: TouchedRange[],
): TouchedSymbol[] {
  const byFile = new Map<string, TouchedRange[]>();
  for (const r of ranges) {
    const list = byFile.get(r.file);
    if (list) list.push(r);
    else byFile.set(r.file, [r]);
  }

  const stmt = db.prepare(
    `SELECT symbol, start_line, end_line, exported, callers, deps
       FROM symbols WHERE project_path = ? AND file = ?`,
  );

  const touched: TouchedSymbol[] = [];
  for (const [file, fileRanges] of byFile) {
    const rows = stmt.all(projectPath, file) as SymbolRow[];
    for (const row of rows) {
      const hit = fileRanges.some((r) => rangesOverlap(row.start_line, row.end_line, r.start, r.end));
      if (!hit) continue;
      touched.push({
        file,
        symbol: row.symbol,
        exported: !!row.exported,
        callers: row.callers ? JSON.parse(row.callers) : [],
        deps: row.deps ? JSON.parse(row.deps) : [],
        range: [row.start_line, row.end_line],
      });
    }
  }

  return touched;
}
