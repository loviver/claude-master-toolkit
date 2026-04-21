/**
 * CLI option shapes for `ctk record` and `ctk recall`.
 *
 * Type names aligned with the domain:
 *   - `record` fills the `findings` table (see src/shared/indexer/queries.ts)
 *   - `recall` queries it (RecallOpts in src/shared/indexer/types.ts)
 *
 * All string fields here are pre-validation: Commander hands them in raw,
 * the command validates runtime.
 */

export interface RecordFindingOpts {
  type?: string;
  symbol?: string;
  file?: string;
  finding?: string;
  confidence?: string;
  role?: string;
}

export interface RecallFindingsOpts {
  type?: string;
  symbol?: string;
  session?: string;
  since?: string;
}
