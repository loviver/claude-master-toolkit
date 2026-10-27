import { watch } from 'chokidar';
import { syncFile } from './index.js';
import { sessionSources } from './sources/registry.js';

type WatcherCallback = (event: 'synced', filePath: string) => void;

/**
 * Watch every registered session source's globs for changes.
 * On change, incrementally sync the file into SQLite.
 */
export function startWatcher(callback?: WatcherCallback) {
  const watcher = watch(sessionSources.flatMap((s) => s.watchGlobs()), {
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
