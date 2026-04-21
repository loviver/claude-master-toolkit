import { output, outputError } from '../../shared/output.js';
import { openDb } from '../../shared/indexer/db-raw.js';
import { recordFinding, recallFindings } from '../../shared/indexer/queries.js';
import type { FindingType, RecallOpts } from '../../shared/indexer/types.js';
import type { RecordFindingOpts, RecallFindingsOpts } from '../types/findings-opts.js';

const VALID_TYPES: FindingType[] = ['bug', 'assumption', 'decision', 'deadend', 'pattern'];

function parseSince(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d+)([smhd])$/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  const mul = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return n * mul;
}

export function recordCommand(opts: RecordFindingOpts): void {
  if (!opts.type || !VALID_TYPES.includes(opts.type as FindingType)) {
    outputError(`record: --type must be one of ${VALID_TYPES.join('|')}`);
  }
  if (!opts.finding) outputError('record: --finding="..." required');

  const db = openDb();
  try {
    const r = recordFinding(db, {
      type: opts.type as FindingType,
      symbol: opts.symbol,
      file: opts.file,
      finding: opts.finding!,
      confidence: opts.confidence ? parseFloat(opts.confidence) : undefined,
      agentRole: opts.role,
    });
    output({ recorded: true, id: r.id });
  } finally {
    db.close();
    process.exit(0);
  }
}

export function recallCommand(opts: RecallFindingsOpts): void {
  const db = openDb();
  try {
    const ropts: RecallOpts = {
      type: opts.type as FindingType | undefined,
      symbol: opts.symbol,
      sessionId: opts.session,
      sinceMs: parseSince(opts.since),
    };
    const findings = recallFindings(db, ropts);
    output({ findings, count: findings.length });
  } finally {
    db.close();
    process.exit(0);
  }
}
