import type { Stats } from 'fs';
import type { AppDb } from '../../../shared/db/db.js';
import { syncState } from '../../../shared/db/schema.js';

export function persistSyncState(db: AppDb, filePath: string, stat: Stats): void {
  db.insert(syncState)
    .values({ filePath, lastByteOffset: stat.size, lastModified: stat.mtimeMs })
    .onConflictDoUpdate({
      target: syncState.filePath,
      set: { lastByteOffset: stat.size, lastModified: stat.mtimeMs },
    })
    .run();
}
