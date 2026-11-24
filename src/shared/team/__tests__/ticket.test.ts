import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'fs';
import { captureContext, currentBranch, ticketFromBranch } from '../ticket.js';
import { git, makeRepo, tmp } from './helpers.js';

describe('team/ticket', () => {
  const dirs: string[] = [];
  const dir = () => { const d = tmp('ctk-ticket-'); dirs.push(d); return d; };
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it.each([
    ['feat/DEV-3033-team-vault', 'DEV-3033'],
    ['DEV-1', 'DEV-1'],
    ['fix/OPS-12-and-DEV-9', 'OPS-12'],
    ['fix/utf-8-names', null],
    ['main', null],
    ['feat/TOOLONGKEY-1-x', null],
    [null, null],
  ])('ticketFromBranch(%s) -> %s', (branch, expected) => {
    expect(ticketFromBranch(branch)).toBe(expected);
  });

  it('captures ticket, author, commit and branch from a repo', () => {
    const repo = makeRepo(dir(), 'feat/DEV-7-x');
    expect(captureContext(repo)).toEqual({
      ticket: 'DEV-7',
      author: 'dev@example.com',
      commitSha: git(repo, 'rev-parse', 'HEAD'),
      gitBranch: 'feat/DEV-7-x',
    });
  });

  it('returns nulls outside a git repo instead of failing', () => {
    const plain = dir();
    expect(currentBranch(plain)).toBeNull();
    expect(captureContext(plain)).toMatchObject({ ticket: null, commitSha: null, gitBranch: null });
  });
});
