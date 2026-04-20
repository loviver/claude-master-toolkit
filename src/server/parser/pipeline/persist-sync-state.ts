import type { Stats } from 'fs';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { syncState } from '../../db/schema.js';

export function persistSyncState(db: BetterSQLite3Database, filePath: string, stat: Stats): void {
  db.insert(syncState)
    .values({ filePath, lastByteOffset: stat.size, lastModified: stat.mtimeMs })
    .onConflictDoUpdate({
      target: syncState.filePath,
      set: { lastByteOffset: stat.size, lastModified: stat.mtimeMs },
    })
    .run();
}
