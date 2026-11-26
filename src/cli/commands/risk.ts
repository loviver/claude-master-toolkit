import { output, outputError, isJsonMode } from '../../shared/output.js';
import { assessRisk } from '../../shared/risk/index.js';
import { formatRationale, riskNotes } from '../../shared/risk/format.js';

interface RiskOptions {
  base?: string;
  /** Measure committed changes only (default: committed + uncommitted + untracked). */
  committed?: boolean;
}

/**
 * `ctk risk` — advisory ODD risk read of the current branch vs its base.
 * Prints the signals, score, tier and transparent rationale. ADVISORY: it
 * suggests a tier, the human decides the flow.
 */
export function riskCommand(opts: RiskOptions = {}): void {
  try {
    const assessment = assessRisk({ base: opts.base, worktree: !opts.committed });

    if (isJsonMode()) {
      output(assessment);
      return;
    }

    const { signals, score, base, touched, ranges } = assessment;
    const notes = riskNotes(assessment);
    const files = new Set(ranges.map((r) => r.file)).size;
    const churn = ranges.reduce((sum, r) => sum + r.added, 0);
    const sig = [
      `blastRadius=${signals.blastRadius}`,
      `maxSymbolCallers=${signals.maxSymbolCallers}`,
      `publicApi=${signals.publicApi}`,
      `spread=${signals.spread}`,
      `churn=${signals.churn}`,
      `priorBugs=${signals.priorBugs}`,
    ].join('  ');

    const lines = [
      `Risk: ${score.tier}  (score ${score.score.toFixed(2)})  vs ${base}`,
      `Scope: ${assessment.worktree ? 'working tree' : 'committed'}  (${files} file(s), +${churn} line(s))`,
      `Signals: ${sig}`,
      `Touched: ${touched.length} symbol(s)`,
      ...notes.map((n) => `Note: ${n}`),
      'Rationale:',
      ...formatRationale(score.rationale).map((r) => `  - ${r}`),
    ];
    output(lines.join('\n'));
  } catch (err) {
    outputError(`ctk risk failed: ${(err as Error).message}`);
  }
}
