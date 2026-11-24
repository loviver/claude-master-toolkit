/** Team-vault rules: what may leave the machine and how team memories land in the local vault. */
import type Database from 'better-sqlite3';
import { homedir } from 'os';
import { rowById } from '../memories/crud.js';
import { readGitProvenance } from '../bench/provenance.js';
import { readSetting, writeSetting } from './config.js';
import { projectSlug, toTeamMemory, type TeamMemory } from './format.js';
import { scanFields } from './privacy.js';
import type { Proposal, SyncPort } from './sync-port.js';

const CURSOR = 'team.cursor';

export interface PromoteInput {
  ids: string[];
  /** Ticket for memories saved without one. */
  ticket?: string;
  cwd?: string;
}

export function promote(db: Database.Database, port: SyncPort, input: PromoteInput): Proposal {
  const blocked: string[] = [];
  const memories = input.ids.map((id) => {
    const row = rowById(db, id);
    if (!row) throw new Error(`memory '${id}' not found`);
    if (row.type === 'session_summary') {
      throw new Error(`memory '${id}' is a session_summary; only curated memories can be shared`);
    }
    const memory = toTeamMemory(row, {
      project: projectSlug(row.project_path),
      home: homedir(),
      ticket: row.ticket ?? input.ticket ?? null,
      author: row.author ?? readGitProvenance(row.project_path ?? input.cwd).author,
    });
    // `author` is deliberate provenance, so it is the one field that is not scanned.
    const { author: _author, id: _id, ...content } = memory;
    const fields = Object.fromEntries(Object.entries(content).filter(([, v]) => typeof v === 'string'));
    for (const v of scanFields(fields as Record<string, string>)) {
      blocked.push(`memory ${id}: field '${v.field}' matches ${v.rule}`);
    }
    return memory;
  });
  if (blocked.length > 0) {
    throw new Error(`promote blocked by the privacy scan, nothing was pushed:\n${blocked.join('\n')}`);
  }
  return port.propose(memories);
}

export interface PullResult {
  upToDate: boolean;
  imported: number;
  updated: number;
  invalid: string[];
}

function insert(db: Database.Database, m: TeamMemory, now: number): void {
  db.prepare(
    `INSERT INTO memories_v2 (
       id, title, type, what, why, where_, learned, topic_key, description, file_path,
       ticket, author, commit_sha, git_branch, scope, created_at, updated_at, team_synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'team', ?, ?, ?)`,
  ).run(
    m.id, m.title, m.type, m.what, m.why, m.where, m.learned, m.topicKey, m.description, m.filePath,
    m.ticket, m.author, m.commit, m.branch, m.createdAt, m.updatedAt, now,
  );
}

function overwrite(db: Database.Database, m: TeamMemory, now: number): void {
  db.prepare(
    `UPDATE memories_v2
     SET title = ?, type = ?, what = ?, why = ?, where_ = ?, learned = ?, topic_key = ?,
         description = ?, file_path = ?, ticket = ?, author = ?, commit_sha = ?, git_branch = ?,
         scope = 'team', updated_at = ?, team_synced_at = ?
     WHERE id = ?`,
  ).run(
    m.title, m.type, m.what, m.why, m.where, m.learned, m.topicKey, m.description, m.filePath,
    m.ticket, m.author, m.commit, m.branch, m.updatedAt, now, m.id,
  );
}

/** Newer wins. A local edit newer than the team version is never overwritten. */
export function pull(db: Database.Database, port: SyncPort): PullResult {
  const snapshot = port.fetch(readSetting(db, CURSOR));
  if (!snapshot) return { upToDate: true, imported: 0, updated: 0, invalid: [] };

  const result: PullResult = { upToDate: false, imported: 0, updated: 0, invalid: snapshot.invalid };
  db.transaction(() => {
    const now = Date.now();
    for (const m of snapshot.memories) {
      const local = rowById(db, m.id);
      if (!local) {
        insert(db, m, now);
        result.imported++;
        continue;
      }
      const localUpdated = local.updated_at ?? local.created_at;
      if (m.updatedAt > localUpdated) {
        overwrite(db, m, now);
        result.updated++;
      } else if (m.updatedAt === localUpdated && local.scope !== 'team') {
        // The author's own copy: accepted by review, so it becomes team knowledge here too.
        db.prepare(`UPDATE memories_v2 SET scope = 'team', team_synced_at = ? WHERE id = ?`).run(now, m.id);
        result.updated++;
      }
    }
    writeSetting(db, CURSOR, snapshot.cursor);
  })();
  return result;
}
