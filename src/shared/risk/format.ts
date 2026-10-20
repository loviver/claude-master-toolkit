import type { RiskReason } from './types.js';

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
