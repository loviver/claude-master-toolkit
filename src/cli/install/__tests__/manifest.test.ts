import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readManifest, writeManifest, deleteManifest, manifestPath } from '../manifest.js';

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
});
