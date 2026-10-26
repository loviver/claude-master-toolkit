import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, lstatSync, readlinkSync, readFileSync as rf,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse } from 'smol-toml';
import { installCodex, uninstallCodex, CODEX_SKILLS } from '../codex.js';
import { readManifest } from '../manifest.js';

const REPO = join(__dirname, '..', '..', '..', '..');
let home: string;
let ctkHome: string;
let savedCtk: string | undefined;

const USER_CFG = `# user config
model = "gpt-6-luna"

[hooks.state."/home/u/.codex/hooks.json:PreToolUse:0:0"]
trusted_hash = "sha256:abc"
`;
const USER_HOOKS = '{"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"capture.sh"}]}]}}';

beforeEach(() => {
  savedCtk = process.env['CTK_HOME'];
  home = mkdtempSync(join(tmpdir(), 'ctk-cdx-'));
  ctkHome = join(home, '.ctk');
  process.env['CTK_HOME'] = ctkHome;
  mkdirSync(join(home, '.codex', 'skills'), { recursive: true });
  writeFileSync(join(home, '.codex', 'config.toml'), USER_CFG);
  writeFileSync(join(home, '.codex', 'hooks.json'), USER_HOOKS);
});
afterEach(() => {
  if (savedCtk === undefined) delete process.env['CTK_HOME'];
  else process.env['CTK_HOME'] = savedCtk;
  rmSync(home, { recursive: true, force: true });
});

const ctx = () => ({ home, pkgRoot: REPO });
const cfg = () => readFileSync(join(home, '.codex', 'config.toml'), 'utf8');

describe('CODEX_SKILLS', () => {
  it('only ships skills with no Claude-specific paths (Phase 8 handles the rest)', () => {
    for (const s of CODEX_SKILLS) {
      const body = rf(join(REPO, 'claude-dist', 'skills', s, 'SKILL.md'), 'utf8');
      expect(body, s).not.toMatch(/~\/\.claude|\.claude\//);
    }
  });
});

describe('installCodex', () => {
  it('fails clearly when Codex is not installed', () => {
    rmSync(join(home, '.codex'), { recursive: true });
    expect(() => installCodex(ctx())).toThrow(/~\/\.codex not found/);
  });

  it('registers the MCP server without touching user config or hooks', () => {
    installCodex(ctx());
    expect(cfg().startsWith(USER_CFG)).toBe(true);
    const t = parse(cfg()) as any;
    expect(t.mcp_servers.ctk).toEqual({ command: 'node', args: [join(REPO, 'dist', 'mcp.js')] });
    expect(t.hooks.state['/home/u/.codex/hooks.json:PreToolUse:0:0'].trusted_hash).toBe('sha256:abc');
    expect(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).toBe(USER_HOOKS);
  });

  it('symlinks only the neutral skills into ~/.codex/skills', () => {
    installCodex(ctx());
    for (const s of CODEX_SKILLS) {
      const link = join(home, '.codex', 'skills', s);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe(join(REPO, 'claude-dist', 'skills', s));
    }
    expect(existsSync(join(home, '.codex', 'skills', 'delegate'))).toBe(false);
  });

  it('does not install agents or AGENTS.md yet (content is still Claude-specific)', () => {
    installCodex(ctx());
    expect(existsSync(join(home, '.codex', 'agents'))).toBe(false);
    expect(existsSync(join(home, '.codex', 'AGENTS.md'))).toBe(false);
  });

  it('never replaces a real skill dir the user owns', () => {
    const mine = join(home, '.codex', 'skills', CODEX_SKILLS[0]!);
    mkdirSync(mine);
    writeFileSync(join(mine, 'SKILL.md'), 'mine');
    const r = installCodex(ctx());
    expect(readFileSync(join(mine, 'SKILL.md'), 'utf8')).toBe('mine');
    expect(lstatSync(mine).isSymbolicLink()).toBe(false);
    expect(r.warnings.join('\n')).toContain(CODEX_SKILLS[0]);
  });

  it('refuses (no changes) when the user already defines [mcp_servers.ctk]', () => {
    writeFileSync(join(home, '.codex', 'config.toml'), USER_CFG + '\n[mcp_servers.ctk]\ncommand = "mine"\n');
    expect(() => installCodex(ctx())).toThrow(/already defines/);
    expect(existsSync(join(home, '.codex', 'skills', CODEX_SKILLS[0]!))).toBe(false);
  });

  it('records a manifest and is idempotent', () => {
    installCodex(ctx());
    const first = readManifest('codex')!;
    const cfgAfter = cfg();
    installCodex(ctx());
    expect(cfg()).toBe(cfgAfter);
    expect(readManifest('codex')!.entries).toEqual(first.entries);
    expect(first.entries.filter((e) => e.type === 'symlink')).toHaveLength(CODEX_SKILLS.length);
    expect(first.entries.filter((e) => e.type === 'toml-block')).toHaveLength(1);
  });
});

describe('uninstallCodex', () => {
  it('removes exactly what install added; user config byte-identical', () => {
    installCodex(ctx());
    uninstallCodex(ctx());
    expect(cfg()).toBe(USER_CFG);
    for (const s of CODEX_SKILLS) expect(existsSync(join(home, '.codex', 'skills', s))).toBe(false);
    expect(readManifest('codex')).toBeNull();
    expect(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).toBe(USER_HOOKS);
  });

  it('leaves skills the user replaced after install', () => {
    installCodex(ctx());
    const link = join(home, '.codex', 'skills', CODEX_SKILLS[0]!);
    rmSync(link);
    mkdirSync(link);
    uninstallCodex(ctx());
    expect(existsSync(link)).toBe(true);
  });

  it('is a no-op when nothing is installed', () => {
    expect(() => uninstallCodex(ctx())).not.toThrow();
    expect(cfg()).toBe(USER_CFG);
  });
});
