/**
 * CLI option shapes for `ctk bench <subcmd>`.
 *
 * Variant/success/model are validated runtime (Commander → string → parsed).
 */

export interface BenchTaskAddOpts {
  name?: string;
  description?: string;
  oracle?: string;
}

export interface BenchIngestOpts {
  task?: string;
  variant?: string;
  model?: string;
  notes?: string;
  success?: string;
}

export interface BenchListOpts {
  task?: string;
  variant?: string;
}

export interface BenchCompareOpts {
  task?: string;
}

export interface BenchExportOpts {
  task?: string;
  out?: string;
  includePaths?: boolean;
}
