import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { migrate } from '../../db/migrate.js';
import { openMemDb, save } from '../../memories/v2.js';
import { createGitAdapter } from '../git-adapter.js';
import { ownerFromRemote } from '../ownership.js';
import { promote } from '../service.js';
import type { SyncPort } from '../sync-port.js';
import { git, makeRepo, tmp } from './helpers.js';

describe('team/ownership', () => {
  it.each([
    ['git@github.com:Acme/shop-api.git', 'acme'],
    ['https://github.com/acme/shop-api', 'acme'],
    ['ssh://git@github.com/acme/shop-api.git', 'acme'],
    ['https://token@github.com/acme/shop-api.git', 'acme'],
    ['file:///tmp/knowledge.git', null],
    ['/tmp/knowledge.git', null],
  ])('ownerFromRemote(%s) -> %s', (url, owner) => {
    expect(ownerFromRemote(url)).toBe(owner);
  });

  describe('promote', () => {
    let root: string;
    let original: string | undefined;
    let proposed: number;

    const port = (allowedOwners: string[] | null): SyncPort => ({
      allowedOwners: () => allowedOwners,
      propose: (m) => { proposed += m.length; return { branch: 'b', url: null }; },
      fetch: () => null,
    });

    function project(name: string, origin?: string): string {
      const dir = join(root, name);
      mkdirSync(dir);
      makeRepo(dir, 'main');
      if (origin) git(dir, 'remote', 'add', 'origin', origin);
      return dir;
    }

    beforeEach(() => {
      original = process.env['CTK_DB_PATH'];
      root = tmp('ctk-own-');
      process.env['CTK_DB_PATH'] = join(root, 'db.sqlite');
      proposed = 0;
      migrate();
    });

    afterEach(() => {
      if (original !== undefined) process.env['CTK_DB_PATH'] = original;
      else delete process.env['CTK_DB_PATH'];
      rmSync(root, { recursive: true, force: true });
    });

    it('allows only projects of an allowed owner, and pushes nothing otherwise', () => {
      const db = openMemDb();
      const work = save(db, { title: 'work', projectPath: project('w', 'git@github.com:Acme/api.git') });
      const mine = save(db, { title: 'mine', projectPath: project('p', 'git@github.com:someone/toy.git') });
      const noOrigin = save(db, { title: 'local', projectPath: project('l') });
      const nowhere = save(db, { title: 'nowhere' });

      for (const other of [mine, noOrigin, nowhere]) {
        expect(() => promote(db, port(['acme']), { ids: [work.id, other.id] })).toThrow(
          new RegExp(`${other.id}.*acme`),
        );
      }
      expect(proposed).toBe(0);
      promote(db, port(['acme']), { ids: [work.id] });
      expect(proposed).toBe(1);
      db.close();
    });

    it('does not restrict when the team vault declares no owners', () => {
      const db = openMemDb();
      promote(db, port(null), { ids: [save(db, { title: 'any' }).id] });
      expect(proposed).toBe(1);
      db.close();
    });
  });

  describe('git adapter policy', () => {
    let root: string;
    beforeEach(() => { root = tmp('ctk-policy-'); });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    function knowledge(config?: string) {
      const remote = join(root, 'k.git');
      git(root, 'init', '-q', '--bare', '-b', 'main', remote);
      const seed = join(root, 'seed');
      mkdirSync(seed);
      makeRepo(seed, 'main');
      if (config !== undefined) {
        writeFileSync(join(seed, 'ctk-team.json'), config);
        git(seed, 'add', '-A');
        git(seed, 'commit', '-q', '-m', 'policy');
      }
      git(seed, 'push', '-q', remote, 'main');
      const clone = join(root, 'clone');
      git(root, 'clone', '-q', remote, clone);
      return createGitAdapter({ repoPath: clone });
    }

    it('reads allowed owners from ctk-team.json on the base branch', () => {
      expect(knowledge('{"allowedOwners":["Acme","other"]}').allowedOwners()).toEqual(['acme', 'other']);
    });

    it('has no restriction for a local remote without config', () => {
      expect(knowledge().allowedOwners()).toBeNull();
    });

    it('fails closed on an invalid config', () => {
      expect(() => knowledge('{"allowedOwners": "acme"}').allowedOwners()).toThrow(/ctk-team\.json/);
    });

    it('defaults to the owner of the knowledge repo itself', () => {
      const clone = join(root, 'owned');
      mkdirSync(clone);
      makeRepo(clone, 'main');
      git(clone, 'remote', 'add', 'origin', 'git@github.com:Acme/knowledge.git');
      git(clone, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
      // Keep the test offline: fetch resolves against a local mirror.
      const mirror = join(root, 'mirror.git');
      git(root, 'clone', '-q', '--bare', clone, mirror);
      git(clone, 'config', `url.${mirror}.insteadOf`, 'git@github.com:Acme/knowledge.git');
      expect(createGitAdapter({ repoPath: clone }).allowedOwners()).toEqual(['acme']);
    });
  });
});
