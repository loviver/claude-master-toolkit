import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ClaudeCodeAdapter, getAdapter, listAdapters, StubAdapter } from '../index.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ctk-adapter-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('ClaudeCodeAdapter', () => {
  const a = new ClaudeCodeAdapter();

  it('identity + tier', () => {
    expect(a.agent()).toBe('claude-code');
    expect(a.tier()).toBe('full');
  });

  it('paths resolve under ~/.claude', () => {
    expect(a.globalConfigDir(home)).toBe(join(home, '.claude'));
    expect(a.systemPromptFile(home)).toBe(join(home, '.claude', 'CLAUDE.md'));
    expect(a.skillsDir(home)).toBe(join(home, '.claude', 'skills'));
    expect(a.settingsPath(home)).toBe(join(home, '.claude', 'settings.json'));
    expect(a.commandsDir(home)).toBe(join(home, '.claude', 'commands'));
  });

  it('detect: no .claude dir → not installed', async () => {
    const r = await a.detect(home);
    expect(r.installed).toBe(false);
    expect(r.configFound).toBe(false);
  });

  it('detect: settings.json present → configFound', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), '{}');
    const r = await a.detect(home);
    expect(r.installed).toBe(true);
    expect(r.configFound).toBe(true);
    expect(r.configPath).toBe(join(home, '.claude', 'settings.json'));
  });

  it('strategies + capabilities', () => {
    expect(a.systemPromptStrategy()).toBe('file-replace');
    expect(a.mcpStrategy()).toBe('json');
    expect(a.supportsSkills()).toBe(true);
    expect(a.supportsMCP()).toBe(true);
    expect(a.supportsOutputStyles()).toBe(false);
  });
});

describe('StubAdapter', () => {
  it('throws on install/path calls', () => {
    const s = new StubAdapter('cursor');
    expect(s.tier()).toBe('stub');
    expect(() => s.globalConfigDir('/h')).toThrow(/not supported/);
    expect(() => s.installCommand({ platform: 'linux', arch: 'x64' })).toThrow();
  });

  it('detect returns not installed', async () => {
    const s = new StubAdapter('opencode');
    expect((await s.detect('/h')).installed).toBe(false);
  });
});

describe('registry', () => {
  it('getAdapter returns claude-code full adapter', () => {
    expect(getAdapter('claude-code').tier()).toBe('full');
  });

  it('getAdapter returns stubs for others', () => {
    for (const id of ['opencode', 'cursor', 'codex'] as const) {
      expect(getAdapter(id).tier()).toBe('stub');
    }
  });

  it('listAdapters returns 4 entries', () => {
    expect(listAdapters()).toHaveLength(4);
  });
});
