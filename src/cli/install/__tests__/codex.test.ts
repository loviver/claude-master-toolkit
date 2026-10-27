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
    expect(JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).hooks.PreToolUse[0]).toEqual(JSON.parse(USER_HOOKS).hooks.PreToolUse[0]);
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
    expect(first.entries.filter((e) => e.type === 'toml-block').map((e: any) => e.id)).toEqual(['mcp', 'sandbox']);
  });
});

const hooksJson = () => JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).hooks as Record<string, any[]>;
const ctkCommands = (h: Record<string, any[]>) =>
  Object.entries(h).flatMap(([ev, groups]) =>
    groups.flatMap((g: any) => g.hooks.filter((x: any) => /hook\.js/.test(x.command)).map((x: any) => ({ ev, matcher: g.matcher, ...x }))),
  );

describe('installCodex: hooks.json registration', () => {
  it('registers the verified events with the Codex agent flag and absolute runtime path', () => {
    installCodex(ctx());
    const cmds = ctkCommands(hooksJson());
    expect(cmds.map((c) => c.ev).sort()).toEqual(['PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']);
    for (const c of cmds) {
      expect(c.type).toBe('command');
      expect(c.command).toBe(`node "${join(REPO, 'dist', 'hook.js')}" ${c.ev} --agent codex`);
    }
  });

  it('PreToolUse/PostToolUse only match Bash (apply_patch/MCP/spawn have no verified contract)', () => {
    installCodex(ctx());
    const cmds = ctkCommands(hooksJson());
    expect(cmds.find((c) => c.ev === 'PreToolUse')!.matcher).toBe('Bash');
    expect(cmds.find((c) => c.ev === 'PostToolUse')!.matcher).toBe('Bash');
  });

  it('does not register events whose Codex output is unsupported or unverified', () => {
    installCodex(ctx());
    const events = Object.keys(hooksJson());
    for (const ev of ['PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'PermissionRequest']) {
      expect(ctkCommands({ [ev]: hooksJson()[ev] ?? [] })).toEqual([]);
      expect(events.includes(ev) ? ctkCommands({ [ev]: hooksJson()[ev]! }) : []).toEqual([]);
    }
  });

  it('timeouts stay within Codex limits (SessionEnd max 3s)', () => {
    installCodex(ctx());
    for (const c of ctkCommands(hooksJson())) expect(c.timeout).toBeLessThanOrEqual(c.ev === 'SessionEnd' ? 3 : 600);
  });

  it('keeps the user hooks, is idempotent, and creates hooks.json when absent', () => {
    installCodex(ctx());
    installCodex(ctx());
    const h = hooksJson();
    expect(h['PreToolUse']!.some((g: any) => g.hooks.some((x: any) => x.command === 'capture.sh'))).toBe(true);
    expect(ctkCommands(h)).toHaveLength(6);

    rmSync(join(home, '.codex', 'hooks.json'));
    installCodex(ctx());
    expect(ctkCommands(hooksJson())).toHaveLength(6);
  });

  it('re-install from a moved package replaces the old ctk hook paths instead of stacking them', () => {
    const oldRoot = join(home, 'old-pkg');
    mkdirSync(join(oldRoot, 'dist'), { recursive: true });
    installCodex({ home, pkgRoot: oldRoot });
    installCodex(ctx());
    const cmds = ctkCommands(hooksJson());
    expect(cmds).toHaveLength(6);
    expect(JSON.stringify(cmds)).not.toContain('old-pkg');
    expect(hooksJson()['PreToolUse']!.some((g: any) => g.hooks.some((x: any) => x.command === 'capture.sh'))).toBe(true);
  });

  it('tells the user to trust the hooks in Codex and never writes [hooks.state] itself', () => {
    const r = installCodex(ctx());
    expect([...r.actions, ...r.warnings].join('\n')).toMatch(/\/hooks/);
    expect((parse(cfg()) as any).hooks.state).toEqual((parse(USER_CFG) as any).hooks.state);
  });

  it('warns when dist/hook.js is missing (not built)', () => {
    const r = installCodex({ home, pkgRoot: join(home, 'nowhere') });
    expect(r.warnings.join('\n')).toMatch(/hook\.js/);
  });

  it('uninstall removes only the ctk hooks (user hooks and trust state untouched)', () => {
    installCodex(ctx());
    uninstallCodex(ctx());
    expect(ctkCommands(hooksJson())).toEqual([]);
    expect(hooksJson()['PreToolUse']).toEqual(JSON.parse(USER_HOOKS).hooks.PreToolUse);
    expect(cfg()).toBe(USER_CFG);
  });

  it('uninstall deletes a hooks.json that install created and nothing else uses', () => {
    rmSync(join(home, '.codex', 'hooks.json'));
    installCodex(ctx());
    uninstallCodex(ctx());
    expect(existsSync(join(home, '.codex', 'hooks.json'))).toBe(false);
  });
});

describe('uninstallCodex', () => {
  it('removes exactly what install added; user config byte-identical', () => {
    installCodex(ctx());
    uninstallCodex(ctx());
    expect(cfg()).toBe(USER_CFG);
    for (const s of CODEX_SKILLS) expect(existsSync(join(home, '.codex', 'skills', s))).toBe(false);
    expect(readManifest('codex')).toBeNull();
    expect(JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8'))).toEqual(JSON.parse(USER_HOOKS));
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

describe('installCodex: sandbox write access to the ctk home', () => {
  it('lets the workspace-write sandbox write to ~/.ctk (SQLite needs -wal/-shm) and leaves the rest of config.toml alone', () => {
    const r = installCodex(ctx());
    const t = parse(cfg()) as any;
    expect(t.sandbox_workspace_write.writable_roots).toEqual([ctkHome]);
    expect(cfg().startsWith(USER_CFG)).toBe(true);
    expect(r.actions.join('\n')).toContain('sandbox');
  });

  it('uninstall removes the grant', () => {
    installCodex(ctx());
    uninstallCodex(ctx());
    expect(cfg()).toBe(USER_CFG);
  });

  it('never fights a [sandbox_workspace_write] the user already owns: install succeeds, user table untouched, warns', () => {
    const own = USER_CFG + '\n[sandbox_workspace_write]\nnetwork_access = true\n';
    writeFileSync(join(home, '.codex', 'config.toml'), own);
    const r = installCodex(ctx());
    const t = parse(cfg()) as any;
    expect(t.sandbox_workspace_write).toEqual({ network_access: true });
    expect(t.mcp_servers.ctk).toBeDefined();
    expect(r.warnings.join('\n')).toContain('writable_roots');
  });
});
