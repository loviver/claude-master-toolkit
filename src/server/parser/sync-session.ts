import { statSync } from 'fs';
import { eq } from 'drizzle-orm';
import { getDb } from '../../shared/db/db.js';
import { syncState } from '../../shared/db/schema.js';
import { listProjectDirs, listSessionFiles, parseJsonlFile, extractSessionMeta } from '../../shared/jsonl-parser/index.js';
import { syncFile } from './sync-file.js';

export async function syncSession(sessionId: string): Promise<void> {
  const db = getDb();
  const projectDirs = listProjectDirs();

  for (const dir of projectDirs) {
    const files = listSessionFiles(dir);
    for (const file of files) {
      const stat = statSync(file);
      const existing = db.select().from(syncState).where(eq(syncState.filePath, file)).get();
      if (existing?.lastModified === stat.mtimeMs) continue;

      const allEvents = await parseJsonlFile(file);
      const meta = extractSessionMeta(allEvents);
      if (meta.sessionId === sessionId) {
        await syncFile(file);
        return;
      }
    }
  }
}
