import Database from 'better-sqlite3';

/** Every table syncFile writes, with its stable sort key. */
const SYNC_TABLES: Array<[string, string]> = [
  ['sessions', 'id'],
  ['token_events', 'id'],
  ['turn_tool_calls', 'id'],
  ['turn_content', 'id'],
  ['turn_hooks', 'id'],
  ['turn_file_changes', 'id'],
  ['sync_state', 'file_path'],
];

/** Snapshot-friendly dump: temp dir paths become `<TMP>`, file mtimes `<MTIME>`. */
export function dumpSyncTables(dbPath: string, tmpDir: string): Record<string, unknown[]> {
  const db = new Database(dbPath, { readonly: true });
  const out: Record<string, unknown[]> = {};
  for (const [table, order] of SYNC_TABLES) {
    out[table] = db
      .prepare(`SELECT * FROM ${table} ORDER BY ${order}`)
      .all()
      .map((row) => {
        const r = { ...(row as Record<string, unknown>) };
        for (const [k, v] of Object.entries(r)) {
          if (typeof v === 'string') r[k] = v.split(tmpDir).join('<TMP>');
        }
        if (table === 'sync_state') r.last_modified = '<MTIME>';
        return r;
      });
  }
  db.close();
  return out;
}
