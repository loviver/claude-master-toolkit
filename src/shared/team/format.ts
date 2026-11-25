/** Interchange format of the team vault: one JSON file per memory. */
import { execFileSync } from 'child_process';
import { basename } from 'path';
import { z } from 'zod';
import type { MemoryRow } from '../memories/types.js';
import { redactHome } from './privacy.js';

const text = z.string().max(20_000).nullable();
const TICKET = z.string().regex(/^[A-Z]{2,6}-[0-9]+$/);

const TeamMemorySchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  project: z.string().regex(/^[a-z0-9_][a-z0-9._-]*$/),
  ticket: TICKET.nullable(),
  title: z.string().min(1).max(500),
  // session_summary is excluded on purpose: transcripts never reach the team vault.
  type: z.enum(['decision', 'bugfix', 'architecture', 'pattern', 'preference', 'reference', 'note']),
  what: text,
  why: text,
  where: text,
  learned: text,
  topicKey: text,
  description: text,
  filePath: text,
  author: text,
  commit: text,
  branch: text,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type TeamMemory = z.infer<typeof TeamMemorySchema>;

/** Stable across machines: the origin repo name, else the folder name. */
export function projectSlug(projectPath: string | null): string {
  let name = '';
  if (projectPath) {
    try {
      const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      name = basename(url.replace(/\/+$/, '')).replace(/\.git$/, '');
    } catch {
      /* no origin */
    }
    name ||= basename(projectPath);
  }
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+/, '') || '_no-project';
}

export interface ToTeamOptions {
  project: string;
  home: string;
  ticket: string | null;
  author: string | null;
}

/** Whitelist of fields: costs, tokens, session ids and local paths never leave the machine. */
export function toTeamMemory(row: MemoryRow, opts: ToTeamOptions): TeamMemory {
  const clean = (v: string | null) => (v === null ? null : redactHome(v, opts.home));
  const parsed = TeamMemorySchema.safeParse({
    version: 1,
    id: row.id,
    project: opts.project,
    ticket: opts.ticket,
    title: redactHome(row.title, opts.home),
    type: row.type ?? 'note',
    what: clean(row.what),
    why: clean(row.why),
    where: clean(row.where_),
    learned: clean(row.learned),
    topicKey: clean(row.topic_key),
    description: clean(row.description),
    filePath: clean(row.file_path),
    author: opts.author,
    commit: row.commit_sha,
    branch: row.git_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`memory '${row.id}' cannot be shared (${issues})`);
  }
  return parsed.data;
}

/** Repo content is untrusted input: anything that does not match the schema returns null. */
export function parseTeamMemory(raw: string): TeamMemory | null {
  try {
    const parsed = TeamMemorySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function memoryPath(m: TeamMemory): string {
  return `memories/${m.project}/${m.ticket ?? '_no-ticket'}/${m.id}.json`;
}
