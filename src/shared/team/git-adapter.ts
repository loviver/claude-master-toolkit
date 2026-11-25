/**
 * Git backend of the team vault. Works through a temporary worktree and `git show`, so the
 * user's checkout of the knowledge repo is never modified.
 */
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { z } from 'zod';
import { originUrl, ownerFromRemote } from './ownership.js';
import { memoryPath, parseTeamMemory, type TeamMemory } from './format.js';
import type { Proposal, Snapshot, SyncPort } from './sync-port.js';

const CONFIG = 'ctk-team.json';
const ConfigSchema = z.object({ allowedOwners: z.array(z.string().min(1)).min(1) });

export interface PrRequest {
  branch: string;
  base: string;
  title: string;
  body: string;
}

/** Returns the PR URL, or null when it could not be opened. */
export type OpenPr = (pr: PrRequest, cwd: string) => string | null;

const ghOpenPr: OpenPr = (pr, cwd) => {
  try {
    const out = execFileSync(
      'gh',
      ['pr', 'create', '--head', pr.branch, '--base', pr.base, '--title', pr.title, '--body', pr.body],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return out.toString().trim().split('\n').pop() || null;
  } catch (e) {
    const err = e as Error & { stderr?: Buffer };
    const reason = err.stderr?.toString().trim() || err.message.split('\n')[0];
    process.stderr.write(`ctk: branch pushed, but 'gh pr create' failed: ${reason}\n`);
    return null;
  }
};

function describePr(memories: TeamMemory[], branch: string): Omit<PrRequest, 'base' | 'branch'> {
  const tickets = [...new Set(memories.map((m) => m.ticket).filter(Boolean))];
  const scope = tickets.join(', ') || branch.replace('ctk/promote-', '');
  const list = memories.map((m) => `- \`${memoryPath(m)}\`: ${m.title}`).join('\n');
  return {
    title: `📝 Promote ${memories.length} team memor${memories.length === 1 ? 'y' : 'ies'} (${scope})`,
    body: [
      '## Resumen',
      `Memorias propuestas para el vault de equipo. Ticket: ${tickets.join(', ') || 'ninguno'}.`,
      '## Cambios',
      list,
      '## PRs relacionados',
      'Ninguno',
      '## Plan de pruebas',
      '- [ ] El contenido es correcto y útil para otra persona',
      '- [ ] No contiene secretos ni datos personales',
    ].join('\n\n'),
  };
}

export function createGitAdapter(opts: { repoPath: string; openPr?: OpenPr }): SyncPort {
  const openPr = opts.openPr ?? ghOpenPr;
  const git = (args: string[], cwd = opts.repoPath): string => {
    try {
      return execFileSync('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }).toString();
    } catch (e) {
      const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim();
      throw new Error(`team repo: git ${args[0]} failed${stderr ? `: ${stderr}` : ''}`);
    }
  };

  const syncBase = (): string => {
    git(['fetch', '--quiet', '--prune', 'origin']);
    try {
      return git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).trim().replace(/^origin\//, '');
    } catch {
      return 'main';
    }
  };

  return {
    allowedOwners(): string[] | null {
      const ref = `origin/${syncBase()}`;
      // Read from the reviewed base branch, so changing the policy needs a PR.
      if (git(['ls-tree', '--name-only', ref, '--', CONFIG]).trim() === '') {
        const url = originUrl(opts.repoPath);
        const own = url ? ownerFromRemote(url) : null;
        return own ? [own] : null;
      }
      try {
        const config = ConfigSchema.parse(JSON.parse(git(['show', `${ref}:${CONFIG}`])));
        return config.allowedOwners.map((o) => o.toLowerCase());
      } catch (e) {
        throw new Error(`team repo: invalid ${CONFIG}: ${(e as Error).message}`);
      }
    },

    propose(memories: TeamMemory[]): Proposal {
      const base = syncBase();
      const label = memories.find((m) => m.ticket)?.ticket ?? new Date().toISOString().slice(0, 10);
      const branch = `ctk/promote-${label}-${randomBytes(3).toString('hex')}`;
      const parent = mkdtempSync(join(tmpdir(), 'ctk-promote-'));
      const tree = join(parent, 'tree');
      try {
        git(['worktree', 'add', '--quiet', '--no-track', '-b', branch, tree, `origin/${base}`]);
        for (const m of memories) {
          const file = join(tree, memoryPath(m));
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);
        }
        git(['add', '--', 'memories'], tree);
        if (git(['status', '--porcelain'], tree).trim() === '') {
          throw new Error('nothing to promote: the team vault already has these exact memories');
        }
        const pr = describePr(memories, branch);
        git(['commit', '--quiet', '-m', `docs(memory): promote ${memories.length} memory file(s) for ${label}`], tree);
        git(['push', '--quiet', 'origin', branch], tree);
        return { branch, url: openPr({ ...pr, base, branch }, tree) };
      } finally {
        rmSync(parent, { recursive: true, force: true });
        git(['worktree', 'prune']);
        try {
          git(['branch', '--quiet', '-D', branch]);
        } catch {
          /* never created */
        }
      }
    },

    fetch(cursor: string | undefined): Snapshot | null {
      const ref = `origin/${syncBase()}`;
      const head = git(['rev-parse', ref]).trim();
      if (head === cursor) return null;
      const paths = git(['ls-tree', '-r', '-z', '--name-only', head, '--', 'memories'])
        .split('\0')
        .filter((p) => p.endsWith('.json'));
      const snapshot: Snapshot = { cursor: head, memories: [], invalid: [] };
      for (const path of paths) {
        const memory = parseTeamMemory(git(['show', `${head}:${path}`]));
        if (memory) snapshot.memories.push(memory);
        else snapshot.invalid.push(path);
      }
      return snapshot;
    },
  };
}
