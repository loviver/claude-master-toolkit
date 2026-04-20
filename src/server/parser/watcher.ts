import { watch } from 'chokidar';
import { join } from 'path';
import { homedir } from 'os';
import { syncFile } from './index.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

type WatcherCallback = (event: 'synced', filePath: string) => void;

/**
 * Watch ~/.claude/projects/ **\/*.jsonl for changes.
 * On change, incrementally sync the file into SQLite.
 */
export function startWatcher(callback?: WatcherCallback) {
  const watcher = watch(join(CLAUDE_PROJECTS_DIR, '**', '*.jsonl'), {
    persistent: true,
    ignoreInitial: true,
    usePolling: false,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  watcher.on('change', async (filePath) => {
    try {
      await syncFile(filePath);
      callback?.('synced', filePath);
    } catch (err) {
      console.error(`[watcher] Error syncing ${filePath}:`, err);
    }
  });

  watcher.on('add', async (filePath) => {
    try {
      await syncFile(filePath);
      callback?.('synced', filePath);
    } catch (err) {
      console.error(`[watcher] Error syncing new file ${filePath}:`, err);
    }
  });

  return watcher;
}
