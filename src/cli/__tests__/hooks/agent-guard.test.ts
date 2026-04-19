import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const GUARD = resolve(__dirname, '../../../../claude-dist/hooks/guards/agent-guard.sh');

let tmpHome: string;
let tmpProject: string;

function runGuard(
  input: unknown,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync('bash', [GUARD], {
    input: JSON.stringify(input),
    env: {
      ...process.env,
      HOME: tmpHome,
      CLAUDE_PROJECT_DIR: tmpProject,
      CTK_HOOK_AGENT_STRICT: '0',
      ...env,
    },
    encoding: 'utf8',
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'ctk-guard-home-'));
  tmpProject = mkdtempSync(join(tmpdir(), 'ctk-guard-proj-'));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpProject, { recursive: true, force: true });
});

describe('agent-guard: persona injection', () => {
  it('injects persona block when ~/.claude/persona.md exists (trusted agent, brief+model OK)', () => {
    mkdirSync(join(tmpHome, '.claude'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', 'persona.md'), '# Senior Architect\nRules here.\n');

    const r = runGuard({
      tool_input: {
        subagent_type: 'Explore',
        prompt: 'ctk_brief_read(id=abc) go',
        model: 'sonnet',
      },
    });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[ctk-persona]');
    expect(r.stdout).toContain('Senior Architect');
  });

  it('omits persona when file missing', () => {
    const r = runGuard({
      tool_input: {
        subagent_type: 'Explore',
        prompt: 'ctk_brief_read(id=abc)',
        model: 'sonnet',
      },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('[ctk-persona]');
  });

  it('CTK_HOOK_PERSONA_INJECT=0 disables persona injection', () => {
    mkdirSync(join(tmpHome, '.claude'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', 'persona.md'), 'PERSONA');
    const r = runGuard(
      {
        tool_input: {
          subagent_type: 'Explore',
          prompt: 'ctk_brief_read(id=abc)',
          model: 'sonnet',
        },
      },
      { CTK_HOOK_PERSONA_INJECT: '0' },
    );
    expect(r.stdout).not.toContain('[ctk-persona]');
  });
});

describe('agent-guard: skill-registry injection', () => {
  it('injects registry pointer when .ctk/skill-registry.md exists', () => {
    mkdirSync(join(tmpProject, '.ctk'), { recursive: true });
    writeFileSync(join(tmpProject, '.ctk', 'skill-registry.md'), '| skill-x | *.ts |\n');

    const r = runGuard({
      tool_input: {
        subagent_type: 'Explore',
        prompt: 'ctk_brief_read(id=abc)',
        model: 'sonnet',
      },
    });
    expect(r.stdout).toContain('[ctk-skills]');
    expect(r.stdout).toContain('skill-x');
  });

  it('no registry file → no injection', () => {
    const r = runGuard({
      tool_input: {
        subagent_type: 'Explore',
        prompt: 'ctk_brief_read(id=abc)',
        model: 'sonnet',
      },
    });
    expect(r.stdout).not.toContain('[ctk-skills]');
  });
});

describe('agent-guard: brief + model enforcement', () => {
  it('trusted agent missing brief → allowed, still injects', () => {
    mkdirSync(join(tmpHome, '.claude'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', 'persona.md'), 'P');
    const r = runGuard({
      tool_input: { subagent_type: 'sdd-orchestrator', prompt: 'go' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[ctk-persona]');
  });

  it('untrusted agent missing brief (non-strict) → allow with hint', () => {
    const r = runGuard({
      tool_input: { subagent_type: 'general-purpose', prompt: 'go' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('without /delegate protocol');
  });

  it('untrusted agent missing brief (strict) → exit 2', () => {
    const r = runGuard(
      { tool_input: { subagent_type: 'general-purpose', prompt: 'go' } },
      { CTK_HOOK_AGENT_STRICT: '1' },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Blocked Agent call');
  });
});
