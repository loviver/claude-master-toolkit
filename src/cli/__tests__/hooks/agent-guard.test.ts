import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

// agent-guard.sh has a single responsibility: enforce the /delegate brief
// protocol on PreToolUse:Agent (it must run here because it needs to DENY the
// spawn). Persona/skill-registry injection moved to subagent-start.sh — see
// subagent-start.test.ts.
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

describe('agent-guard: brief + model enforcement', () => {
  it('trusted agent → allowed, no brief check, no hint', () => {
    const r = runGuard({
      tool_input: { subagent_type: 'sdd-orchestrator', prompt: 'go' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('brief + model both present → allowed silently', () => {
    const r = runGuard({
      tool_input: {
        subagent_type: 'general-purpose',
        prompt: 'ctk_brief_read(id=abc) go',
        model: 'sonnet',
      },
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
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
