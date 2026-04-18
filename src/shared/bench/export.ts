import type Database from 'better-sqlite3';
import { emitSqlDump } from './dump.js';
import { selectRunsWithTurns, selectTasks } from './persist.js';
import { readGitProvenance } from './provenance.js';

export interface ExportOptions {
  taskId?: string;
  includePaths?: boolean;
  author?: string | null;
  commit?: string | null;
}

export function exportToSql(
  db: Database.Database,
  opts: ExportOptions = {},
): string {
  const runs = selectRunsWithTurns(db, opts.taskId);
  const taskIds = [...new Set(runs.map((r) => r.taskId))];
  const tasks = selectTasks(db, taskIds.length > 0 ? taskIds : undefined);

  const prov =
    opts.author !== undefined || opts.commit !== undefined
      ? { author: opts.author ?? null, commit: opts.commit ?? null }
      : readGitProvenance();

  return emitSqlDump({
    tasks,
    runs,
    author: prov.author,
    commit: prov.commit,
    includePaths: opts.includePaths,
  });
}
