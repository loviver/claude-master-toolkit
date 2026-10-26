import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, lstatSync, readlinkSync, readdirSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installClaude, uninstallClaude } from '../claude.js';
import { installCodex, uninstallCodex, CODEX_SKILLS } from '../codex.js';
import { readManifest } from '../manifest.js';

const REPO = join(__dirname, '..', '..', '..', '..');
const DIST = join(REPO, 'claude-dist');
let home: string;
let saved: string | undefined;

beforeEach(() => {
  saved = process.env['CTK_HOME'];
  home = mkdtempSync(join(tmpdir(), 'ctk-cl-'));
  process.env['CTK_HOME'] = join(home, '.ctk');
  mkdirSync(join(home, '.claude'), { recursive: true });
});
afterEach(() => {
  if (saved === undefined) delete process.env['CTK_HOME'];
  else process.env['CTK_HOME'] = saved;
  rmSync(home, { recursive: true, force: true });
});

const ctx = () => ({ home, pkgRoot: REPO });
const settings = () => JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
const claudeJson = () => JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
const isLink = (p: string) => lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink() === true;

describe('installClaude', () => {
  it('fails clearly without ~/.claude', () => {
    rmSync(join(home, '.claude'), { recursive: true });
    expect(() => installClaude(ctx())).toThrow(/~\/\.claude not found/);
  });

  it('creates ~/.claude.json when it does not exist (used to crash) and registers the MCP', () => {
    installClaude(ctx());
    expect(claudeJson().mcpServers.ctk).toEqual({ command: 'node', args: [join(REPO, 'dist', 'mcp.js')] });
  });

  it('links CLAUDE.md, persona, hooks (incl. ts-shim) and EVERY skill/agent by glob', () => {
    installClaude(ctx());
    expect(readlinkSync(join(home, '.claude', 'CLAUDE.md'))).toBe(join(DIST, 'CLAUDE.md'));
    expect(isLink(join(home, '.claude', 'persona.md'))).toBe(true);
    expect(isLink(join(home, '.claude', 'hooks', 'ts-shim.sh'))).toBe(true);
    expect(isLink(join(home, '.claude', 'hooks', 'guards', 'bash-guard.sh'))).toBe(true);
    for (const s of readdirSync(join(DIST, 'skills'))) expect(isLink(join(home, '.claude', 'skills', s)), s).toBe(true);
    for (const a of readdirSync(join(DIST, 'agents'))) expect(isLink(join(home, '.claude', 'agents', a)), a).toBe(true);
  });

  it('merges settings keeping the user hooks and keys', () => {
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine.sh' }] }] } }),
    );
    installClaude(ctx());
    const s = settings();
    expect(s.model).toBe('opus');
    expect(JSON.stringify(s.hooks.Stop)).toContain('mine.sh');
    expect(JSON.stringify(s.hooks.Stop)).toContain('stop.sh');
  });

  it('writes the model preference under ~/.ctk, not the legacy dir', () => {
    installClaude(ctx());
    expect(readFileSync(join(home, '.ctk', 'model-preference'), 'utf8').trim()).toBe('inherit');
    expect(existsSync(join(home, '.claude', 'state'))).toBe(false);
  });

  it('is idempotent (same manifest, same settings)', () => {
    installClaude(ctx());
    const m1 = JSON.stringify(readManifest('claude-code')!.entries);
    const s1 = JSON.stringify(settings());
    installClaude(ctx());
    expect(JSON.stringify(readManifest('claude-code')!.entries)).toBe(m1);
    expect(JSON.stringify(settings())).toBe(s1);
  });
});

describe('uninstallClaude', () => {
  it('removes every ctk artifact but keeps user settings/hooks/keys and ~/.claude.json content', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ numStartups: 3, mcpServers: { other: { command: 'x' } } }));
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine.sh' }] }] } }),
    );
    installClaude(ctx());
    uninstallClaude(ctx());

    const s = settings();
    expect(s.model).toBe('opus');
    expect(JSON.stringify(s)).toContain('mine.sh');
    expect(JSON.stringify(s)).not.toContain('claude-master-toolkit');
    expect(JSON.stringify(s)).not.toContain('/hooks/stop.sh');
    expect(claudeJson()).toEqual({ numStartups: 3, mcpServers: { other: { command: 'x' } } });

    for (const sub of ['skills', 'agents', 'hooks']) {
      const dir = join(home, '.claude', sub);
      if (existsSync(dir)) expect(readdirSync(dir)).toEqual([]);
    }
    expect(existsSync(join(home, '.claude', 'CLAUDE.md'))).toBe(false);
    expect(readManifest('claude-code')).toBeNull();
  });

  it('restores the CLAUDE.md the user had before install', () => {
    writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'my original rules');
    installClaude(ctx());
    expect(isLink(join(home, '.claude', 'CLAUDE.md'))).toBe(true);
    uninstallClaude(ctx());
    expect(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8')).toBe('my original rules');
  });

  it('NEVER deletes the shared database or preferences (used to, through the compat symlink)', () => {
    installClaude(ctx());
    writeFileSync(join(home, '.ctk', 'ctk.sqlite'), 'DB');
    uninstallClaude(ctx());
    expect(readFileSync(join(home, '.ctk', 'ctk.sqlite'), 'utf8')).toBe('DB');
    expect(existsSync(join(home, '.ctk', 'model-preference'))).toBe(true);
  });

  it('leaves third-party hooks/skills alone', () => {
    installClaude(ctx());
    mkdirSync(join(home, '.claude', 'skills', 'theirs'), { recursive: true });
    writeFileSync(join(home, '.claude', 'hooks', 'theirs.sh'), '#!/bin/sh');
    uninstallClaude(ctx());
    expect(existsSync(join(home, '.claude', 'skills', 'theirs'))).toBe(true);
    expect(existsSync(join(home, '.claude', 'hooks', 'theirs.sh'))).toBe(true);
  });

  it('works for installs made before manifests existed (scans symlinks into the package)', () => {
    installClaude(ctx());
    rmSync(join(home, '.ctk', 'installs'), { recursive: true });
    uninstallClaude(ctx());
    expect(existsSync(join(home, '.claude', 'CLAUDE.md'))).toBe(false);
    expect(readdirSync(join(home, '.claude', 'agents'))).toEqual([]);
    expect(JSON.stringify(settings())).not.toContain('/hooks/stop.sh');
    expect(existsSync(join(home, '.claude.json')) ? claudeJson().mcpServers?.ctk : undefined).toBeUndefined();
  });
});

describe('both agents side by side', () => {
  beforeEach(() => {
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'config.toml'), 'model = "gpt-6-luna"\n');
  });

  it('uninstall claude leaves codex fully working', () => {
    installClaude(ctx());
    installCodex(ctx());
    uninstallClaude(ctx());
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toContain('[mcp_servers.ctk]');
    for (const s of CODEX_SKILLS) expect(isLink(join(home, '.codex', 'skills', s))).toBe(true);
    expect(readManifest('codex')).not.toBeNull();
  });

  it('uninstall codex leaves claude fully working', () => {
    installClaude(ctx());
    installCodex(ctx());
    uninstallCodex(ctx());
    expect(claudeJson().mcpServers.ctk).toBeDefined();
    expect(isLink(join(home, '.claude', 'CLAUDE.md'))).toBe(true);
    expect(readManifest('claude-code')).not.toBeNull();
  });

  it('the skills both agents share survive uninstalling either one', () => {
    installClaude(ctx());
    installCodex(ctx());
    uninstallCodex(ctx());
    expect(isLink(join(home, '.claude', 'skills', 'pandorica-protocol'))).toBe(true);
    expect(existsSync(join(DIST, 'skills', 'pandorica-protocol', 'SKILL.md'))).toBe(true);
  });
});
