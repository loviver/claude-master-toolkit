import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

// Persona + skill-registry injection lives on SubagentStart (not PreToolUse:Agent):
// SubagentStart's additionalContext lands in the SUB-AGENT's own transcript,
// which is the cold context that actually needs the persona. SubagentStart is a
// documented event that supports hookSpecificOutput.additionalContext.
const HOOK = resolve(__dirname, '../../../../claude-dist/hooks/subagent-start.sh');

let tmpHome: string;
let tmpProject: string;

function runHook(
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync('bash', [HOOK], {
    input: '{}', // SubagentStart drains stdin; agent_type not needed for injection
    env: {
      ...process.env,
      HOME: tmpHome,
      CLAUDE_PROJECT_DIR: tmpProject,
      ...env,
    },
    encoding: 'utf8',
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'ctk-subagent-home-'));
  tmpProject = mkdtempSync(join(tmpdir(), 'ctk-subagent-proj-'));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpProject, { recursive: true, force: true });
});

describe('subagent-start: persona injection', () => {
  it('injects persona block when ~/.claude/persona.md exists', () => {
    mkdirSync(join(tmpHome, '.claude'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', 'persona.md'), '# Senior Architect\nRules here.\n');

    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[ctk-persona]');
    expect(r.stdout).toContain('Senior Architect');
  });

  it('omits persona when file missing', () => {
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('[ctk-persona]');
  });

  it('CTK_HOOK_PERSONA_INJECT=0 disables persona injection', () => {
    mkdirSync(join(tmpHome, '.claude'), { recursive: true });
    writeFileSync(join(tmpHome, '.claude', 'persona.md'), 'PERSONA');

    const r = runHook({ CTK_HOOK_PERSONA_INJECT: '0' });
    expect(r.stdout).not.toContain('[ctk-persona]');
  });
});

describe('subagent-start: skill-registry injection', () => {
  it('injects registry pointer when .ctk/skill-registry.md exists', () => {
    mkdirSync(join(tmpProject, '.ctk'), { recursive: true });
    writeFileSync(join(tmpProject, '.ctk', 'skill-registry.md'), '| skill-x | *.ts |\n');

    const r = runHook();
    expect(r.stdout).toContain('[ctk-skills]');
    expect(r.stdout).toContain('skill-x');
  });

  it('no registry file → no injection', () => {
    const r = runHook();
    expect(r.stdout).not.toContain('[ctk-skills]');
  });

  it('CTK_HOOK_REGISTRY_INJECT=0 disables registry injection', () => {
    mkdirSync(join(tmpProject, '.ctk'), { recursive: true });
    writeFileSync(join(tmpProject, '.ctk', 'skill-registry.md'), '| skill-x | *.ts |\n');

    const r = runHook({ CTK_HOOK_REGISTRY_INJECT: '0' });
    expect(r.stdout).not.toContain('[ctk-skills]');
  });
});

describe('subagent-start: no injectables', () => {
  it('neither persona nor registry → exit 0, no JSON emitted', () => {
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });
});
