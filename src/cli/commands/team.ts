import { output, outputError } from '../../shared/output.js';
import { openMemDb } from '../../shared/memories/v2.js';
import { getTeamRepo, setTeamRepo } from '../../shared/team/config.js';
import { createGitAdapter } from '../../shared/team/git-adapter.js';
import { promote, pull } from '../../shared/team/service.js';
import type { SyncPort } from '../../shared/team/sync-port.js';
import type { MemPromoteOpts } from '../types/mem-opts.js';

type Db = ReturnType<typeof openMemDb>;

function run(command: string, fn: (db: Db) => unknown): void {
  const db = openMemDb();
  let result: unknown;
  try {
    result = fn(db);
  } catch (e) {
    db.close();
    outputError(`mem ${command}: ${(e as Error).message}`);
    return;
  }
  db.close();
  output(result);
  process.exit(0);
}

function port(db: Db): SyncPort {
  const repoPath = getTeamRepo(db);
  if (!repoPath) {
    throw new Error('no team repo configured. Run: ctk mem team <git-url-or-path> (or set CTK_TEAM_REPO)');
  }
  return createGitAdapter({ repoPath });
}

export function memTeamCommand(repo: string | undefined): void {
  run('team', (db) => ({ repo: repo ? setTeamRepo(db, repo) : (getTeamRepo(db) ?? null) }));
}

export function memPromoteCommand(ids: string[], opts: MemPromoteOpts): void {
  run('promote', (db) => promote(db, port(db), { ids, ticket: opts.ticket, cwd: process.cwd() }));
}

export function memPullCommand(): void {
  run('pull', (db) => pull(db, port(db)));
}
