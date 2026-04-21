import { getDb } from '../../shared/db/db.js';
import { sessions } from '../../shared/db/schema.js';
import { listProjectDirs, listSessionFiles } from '../../shared/jsonl-parser/index.js';
import { syncFile } from './sync-file.js';

export async function syncAll(): Promise<{ files: number; sessions: number }> {
  const projectDirs = listProjectDirs();
  let fileCount = 0;

  for (const dir of projectDirs) {
    const files = listSessionFiles(dir);
    for (const file of files) {
      await syncFile(file);
      fileCount++;
    }
  }

  const db = getDb();
  const sessionCount = db.select().from(sessions).all().length;

  return { files: fileCount, sessions: sessionCount };
}
