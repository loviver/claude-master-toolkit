import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getAdapter, listAdapters } from '../index.js';
import { ClaudeCodeAdapter } from '../claude-code.js';
import { CodexAdapter } from '../codex.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ctk-codex-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('CodexAdapter', () => {
  const a = new CodexAdapter();

  it('identity, tier, strategies', () => {
    expect(a.agent()).toBe('codex');
    expect(a.tier()).toBe('partial');
    expect(a.mcpStrategy()).toBe('toml');
    expect(a.supportsSkills()).toBe(true);
    expect(a.supportsMCP()).toBe(true);
  });

  it('paths resolve under ~/.codex', () => {
    expect(a.globalConfigDir(home)).toBe(join(home, '.codex'));
    expect(a.systemPromptFile(home)).toBe(join(home, '.codex', 'AGENTS.md'));
    expect(a.settingsPath(home)).toBe(join(home, '.codex', 'config.toml'));
    expect(a.mcpConfigPath(home, 'ctk')).toBe(join(home, '.codex', 'config.toml'));
    expect(a.hooksConfigPath(home)).toBe(join(home, '.codex', 'hooks.json'));
    expect(a.agentsDir(home)).toBe(join(home, '.codex', 'agents'));
    expect(a.transcriptsRoot(home)).toBe(join(home, '.codex', 'sessions'));
  });

  it('capabilities reflect Codex hook gaps', () => {
    const c = a.capabilities();
    expect(c.hookAsk).toBe(false);
    expect(c.preCompactContext).toBe(false);
    expect(c.statusLine).toBe(false);
    expect(c.sessionEndReason).toBe(false);
  });

  it('exposes no session-id env (verified: Codex only sets CODEX_MANAGED_*)', () => {
    expect(a.sessionIdEnv()).toBeNull();
  });

  it('readMainModel reads model from config.toml', () => {
    mkdirSync(join(home, '.codex'));
    writeFileSync(join(home, '.codex', 'config.toml'), '# c\nmodel = "gpt-5-codex"\n[mcp_servers.x]\ncommand = "y"\n');
    expect(a.readMainModel(home)).toBe('gpt-5-codex');
  });

  it('readMainModel null when file missing or invalid', () => {
    expect(a.readMainModel(home)).toBeNull();
    mkdirSync(join(home, '.codex'));
    writeFileSync(join(home, '.codex', 'config.toml'), '= not toml [[');
    expect(a.readMainModel(home)).toBeNull();
  });

  it('detect', async () => {
    expect((await a.detect(home)).installed).toBe(false);
    mkdirSync(join(home, '.codex'));
    writeFileSync(join(home, '.codex', 'config.toml'), '');
    const r = await a.detect(home);
    expect(r.installed).toBe(true);
    expect(r.configFound).toBe(true);
  });
});

describe('ClaudeCodeAdapter (fixes)', () => {
  const a = new ClaudeCodeAdapter();
  it('mcpConfigPath is ~/.claude.json, not settings.json', () => {
    expect(a.mcpConfigPath(home, 'ctk')).toBe(join(home, '.claude.json'));
  });
  it('capabilities: full hook support', () => {
    const c = a.capabilities();
    expect(c.hookAsk && c.preCompactContext && c.statusLine && c.sessionEndReason).toBe(true);
  });
  it('readMainModel from settings.json, null otherwise', () => {
    expect(a.readMainModel(home)).toBeNull();
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'settings.json'), '{"model":"opus"}');
    expect(a.readMainModel(home)).toBe('opus');
  });
  it('hooksConfigPath is settings.json', () => {
    expect(a.hooksConfigPath(home)).toBe(join(home, '.claude', 'settings.json'));
  });
});

describe('registry', () => {
  it('codex is a real adapter now', () => {
    expect(getAdapter('codex')).toBeInstanceOf(CodexAdapter);
    expect(listAdapters()).toHaveLength(4);
  });
});
