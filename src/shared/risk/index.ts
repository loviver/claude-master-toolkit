import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { openDb } from '../indexer/db-raw.js';
import { recallFindings } from '../indexer/queries.js';
import { scoreRisk } from './score.js';
import { DEFAULT_RISK_CONFIG, validateConfig } from './config.js';
import { getTouchedRanges, resolveBaseBranch } from './diff.js';
import { mapTouchedSymbols, type TouchedSymbol } from './map.js';
import { qualifyId } from '../indexer/ids.js';
import type { RiskConfig, RiskScore, RiskSignals } from './types.js';
import type { TouchedRange } from './diff.js';

export type { TouchedRange } from './diff.js';
export type { TouchedSymbol } from './map.js';

// ── Pure aggregation ──────────────────────────────────────────

/** Minimal shape of a finding needed to attribute it to touched code. */
interface FindingLike {
  symbol: string | null;
  file: string | null;
}

/**
 * Count bug findings that land on touched code — matched by symbol OR file.
 * Pure: the caller pre-filters to `type: 'bug'` and passes the touched set.
 */
export function countPriorBugs(findings: FindingLike[], touched: TouchedSymbol[]): number {
  const symbols = new Set(touched.map((t) => t.symbol));
  const files = new Set(touched.map((t) => t.file));
  return findings.filter(
    (f) => (f.symbol !== null && symbols.has(f.symbol)) || (f.file !== null && files.has(f.file)),
  ).length;
}

/**
 * Aggregate touched symbols + diff ranges into the raw signals the scorer eats.
 * Pure — no git, no DB. `priorBugs` is passed through already counted.
 */
export function buildSignals(touched: TouchedSymbol[], ranges: TouchedRange[], priorBugs: number): RiskSignals {
  // Compare in the qualified (`file::symbol`) namespace so an internal edge
  // between two same-named-but-different-file symbols isn't mistaken for blast.
  const touchedIds = new Set(touched.map((t) => qualifyId(t.file, t.symbol)));

  // Blast radius: every external symbol that calls a touched one, minus the
  // touched symbols themselves (internal edges don't count as blast).
  const externalCallers = new Set<string>();
  let maxSymbolCallers = 0;
  for (const t of touched) {
    maxSymbolCallers = Math.max(maxSymbolCallers, t.callers.length);
    for (const c of t.callers) {
      if (!touchedIds.has(c)) externalCallers.add(c);
    }
  }

  return {
    blastRadius: externalCallers.size,
    maxSymbolCallers,
    publicApi: touched.filter((t) => t.exported).length,
    spread: new Set(ranges.map((r) => r.file)).size,
    churn: ranges.reduce((acc, r) => acc + r.added, 0),
    priorBugs,
  };
}

// ── Config loading (IO) ───────────────────────────────────────

/**
 * Load `.ctk/risk.json` on top of the defaults. An invalid override is reported
 * (stderr) and ignored — an advisory read must never crash on a bad config.
 */
export function loadRiskConfig(cwd: string = process.cwd()): RiskConfig {
  const file = join(cwd, '.ctk', 'risk.json');
  if (!existsSync(file)) return DEFAULT_RISK_CONFIG;

  let override: Partial<RiskConfig>;
  try {
    override = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`[ctk risk] ignoring unreadable .ctk/risk.json: ${(err as Error).message}`);
    return DEFAULT_RISK_CONFIG;
  }

  const merged: RiskConfig = {
    weights: { ...DEFAULT_RISK_CONFIG.weights, ...override.weights },
    norm: { ...DEFAULT_RISK_CONFIG.norm, ...override.norm },
    tiers: { ...DEFAULT_RISK_CONFIG.tiers, ...override.tiers },
    overrides: { ...DEFAULT_RISK_CONFIG.overrides, ...override.overrides },
  };

  const problems = validateConfig(merged);
  if (problems.length > 0) {
    console.error(`[ctk risk] ignoring invalid .ctk/risk.json: ${problems.join('; ')}`);
    return DEFAULT_RISK_CONFIG;
  }
  return merged;
}

// ── Composition root (IO at the edges) ────────────────────────

export interface AssessRiskOpts {
  base?: string;
  cwd?: string;
  config?: RiskConfig;
}

export interface RiskAssessment {
  base: string;
  signals: RiskSignals;
  score: RiskScore;
  touched: TouchedSymbol[];
}

/**
 * End-to-end advisory risk read: diff → touched symbols → signals → score.
 * Opens and closes the index DB itself. Never throws for an advisory caller
 * beyond git/DB being genuinely unavailable.
 */
export function assessRisk(opts: AssessRiskOpts = {}): RiskAssessment {
  const cwd = opts.cwd ?? process.cwd();
  const base = opts.base ?? resolveBaseBranch(cwd);
  const config = opts.config ?? loadRiskConfig(cwd);

  const ranges = getTouchedRanges({ base, cwd });

  const db = openDb();
  let touched: TouchedSymbol[];
  let priorBugs: number;
  try {
    touched = mapTouchedSymbols(db, cwd, ranges);
    const bugFindings = recallFindings(db, { type: 'bug' });
    priorBugs = countPriorBugs(bugFindings, touched);
  } finally {
    db.close();
  }

  const signals = buildSignals(touched, ranges, priorBugs);
  const score = scoreRisk(signals, config);

  return { base, signals, score, touched };
}
