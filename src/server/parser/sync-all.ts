import { getDb } from '../../shared/db/db.js';
import { sessions } from '../../shared/db/schema.js';
import { sessionSources } from './sources/registry.js';
import { syncFile } from './sync-file.js';

export async function syncAll(): Promise<{ files: number; sessions: number }> {
  let fileCount = 0;

  for (const source of sessionSources) {
    for (const file of source.discover()) {
      await syncFile(file, source);
      fileCount++;
    }
  }

  const db = getDb();
  const sessionCount = db.select().from(sessions).all().length;

  return { files: fileCount, sessions: sessionCount };
}
