import { output, outputError } from '../../shared/output.js';
import { openDb } from '../../shared/indexer/db-raw.js';
import { understand } from '../../shared/indexer/queries.js';

/**
 * Intent-based combined tool. Replaces chaining of:
 *   ctk index find + ctk slice + ctk index deps + ctk index callers
 * Returns signature + body + deps + callers in one JSON payload.
 */
export function understandCommand(name: string): void {
  const db = openDb();
  try {
    const result = understand(db, process.cwd(), name);
    if (!result) {
      outputError(`understand: symbol '${name}' not found. Run 'ctk index build' first.`);
    }
    output(result);
  } finally {
    db.close();
    process.exit(0);
  }
}
