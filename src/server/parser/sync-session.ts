import { statSync } from 'fs';
import { eq } from 'drizzle-orm';
import { getDb } from '../../shared/db/db.js';
import { syncState } from '../../shared/db/schema.js';
import { sessionSources } from './sources/registry.js';
import { syncFile } from './sync-file.js';

export async function syncSession(sessionId: string): Promise<void> {
  const db = getDb();

  for (const source of sessionSources) {
    for (const file of source.discover()) {
      const stat = statSync(file);
      const existing = db.select().from(syncState).where(eq(syncState.filePath, file)).get();
      if (existing?.lastModified === stat.mtimeMs) continue;

      const { meta } = await source.read(file);
      if (meta.sessionId === sessionId) {
        await syncFile(file, source);
        return;
      }
    }
  }
}
