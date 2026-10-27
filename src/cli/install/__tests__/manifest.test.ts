import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readManifest, writeManifest, deleteManifest, manifestPath, assertNotHijacking } from '../manifest.js';

let tmp: string;
let saved: string | undefined;
beforeEach(() => {
  saved = process.env['CTK_HOME'];
  tmp = mkdtempSync(join(tmpdir(), 'ctk-mf-'));
  process.env['CTK_HOME'] = tmp;
});
afterEach(() => {
  if (saved === undefined) delete process.env['CTK_HOME'];
  else process.env['CTK_HOME'] = saved;
  rmSync(tmp, { recursive: true, force: true });
});

describe('manifest', () => {
  it('lives at ~/.ctk/installs/<agent>.json, one per agent', () => {
    expect(manifestPath('codex')).toBe(join(tmp, 'installs', 'codex.json'));
    expect(manifestPath('claude-code')).not.toBe(manifestPath('codex'));
  });

  it('missing => null; write/read roundtrip; delete', () => {
    expect(readManifest('codex')).toBeNull();
    const m = { agent: 'codex', pkgRoot: '/pkg', installedAt: 'now', entries: [{ type: 'symlink' as const, path: '/a' }] };
    writeManifest(m);
    expect(readManifest('codex')).toEqual(m);
    expect(readManifest('claude-code')).toBeNull();
    deleteManifest('codex');
    expect(existsSync(manifestPath('codex'))).toBe(false);
  });

  it('corrupt manifest => null (never crash uninstall)', async () => {
    const { writeFileSync, mkdirSync } = await import('fs');
    mkdirSync(join(tmp, 'installs'), { recursive: true });
    writeFileSync(manifestPath('codex'), '{nope');
    expect(readManifest('codex')).toBeNull();
  });

  describe('assertNotHijacking', () => {
    const owned = (pkgRoot: string) => writeManifest({ agent: 'codex', pkgRoot, installedAt: 'now', entries: [] });
    const checkout = () => {
      const dev = join(tmp, 'dev');
      mkdirSync(join(dev, '.git'), { recursive: true });
      return dev;
    };

    // An `npm i -g` copy running `ctk install` used to silently repoint a dev checkout's links.
    it('refuses a non-git copy taking over an install a git checkout owns', () => {
      const dev = checkout();
      owned(dev);
      mkdirSync(join(tmp, 'npm'));
      expect(() => assertNotHijacking('codex', { home: tmp, pkgRoot: join(tmp, 'npm') })).toThrow(/git checkout.*--force/s);
    });

    it('allows it with force, from the owner itself, or from another checkout', () => {
      const dev = checkout();
      owned(dev);
      mkdirSync(join(tmp, 'npm'));
      expect(() => assertNotHijacking('codex', { home: tmp, pkgRoot: join(tmp, 'npm'), force: true })).not.toThrow();
      expect(() => assertNotHijacking('codex', { home: tmp, pkgRoot: dev })).not.toThrow();
      mkdirSync(join(tmp, 'dev2', '.git'), { recursive: true });
      expect(() => assertNotHijacking('codex', { home: tmp, pkgRoot: join(tmp, 'dev2') })).not.toThrow();
    });

    it('allows it when there is no manifest or the owner is gone (heals a removed checkout)', () => {
      expect(() => assertNotHijacking('codex', { home: tmp, pkgRoot: '/npm' })).not.toThrow();
      owned(join(tmp, 'gone'));
      expect(() => assertNotHijacking('codex', { home: tmp, pkgRoot: '/npm' })).not.toThrow();
    });
  });
});
