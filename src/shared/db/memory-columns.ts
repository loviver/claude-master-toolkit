import type Database from 'better-sqlite3';

/** Team-vault columns added to memories_v2 after v8. */
const MEMORY_COLUMNS: ReadonlyArray<[col: string, type: string]> = [
  ['ticket', 'TEXT'],
  ['author', 'TEXT'],
  ['commit_sha', 'TEXT'],
  ['git_branch', 'TEXT'],
  ['team_synced_at', 'INTEGER'],
];

/** Idempotent. Runs from migrate() and from openDb(), since existing vaults never re-run migrate(). */
export function ensureMemoryColumns(db: Database.Database): void {
  const have = new Set(
    (db.prepare('PRAGMA table_info(memories_v2)').all() as { name: string }[]).map((c) => c.name),
  );
  if (have.size === 0) return;
  for (const [col, type] of MEMORY_COLUMNS) {
    if (have.has(col)) continue;
    try {
      db.exec(`ALTER TABLE memories_v2 ADD COLUMN ${col} ${type}`);
    } catch (e) {
      // Another process (hook or MCP server) added it between the check and the ALTER.
      if (!String((e as Error).message).includes('duplicate column')) throw e;
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_memories_v2_ticket ON memories_v2(ticket)');
}
