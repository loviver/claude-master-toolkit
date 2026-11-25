import { execFileSync } from 'child_process';
import { readGitProvenance } from '../bench/provenance.js';

/** Jira / ClickUp style ids. Upper-case only, so `utf-8` is not a ticket. */
const TICKET = /(?<![A-Za-z0-9])[A-Z]{2,6}-[0-9]+/;

export function ticketFromBranch(branch: string | null): string | null {
  return branch?.match(TICKET)?.[0] ?? null;
}

export function currentBranch(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim() || null;
  } catch {
    return null;
  }
}

export interface MemoryContext {
  ticket: string | null;
  author: string | null;
  commitSha: string | null;
  gitBranch: string | null;
}

/** Where a memory comes from. Never throws: outside a repo the fields are null. */
export function captureContext(cwd: string): MemoryContext {
  const gitBranch = currentBranch(cwd);
  const { author, commit } = readGitProvenance(cwd);
  return { ticket: ticketFromBranch(gitBranch), author, commitSha: commit, gitBranch };
}
