import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const GUARD = resolve(__dirname, '../../../../claude-dist/hooks/guards/edit-guard.sh');

let tmpProject: string;

function run(input: unknown, env: Record<string, string> = {}) {
  return spawnSync('bash', [GUARD], {
    input: JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpProject, ...env },
    encoding: 'utf8',
  });
}

function writeRegistry(rows: string) {
  mkdirSync(join(tmpProject, '.ctk'), { recursive: true });
  writeFileSync(
    join(tmpProject, '.ctk', 'skill-registry.md'),
    `| name | triggers | path | summary |\n|------|----------|------|---------|\n${rows}\n`,
  );
}

beforeEach(() => {
  tmpProject = mkdtempSync(join(tmpdir(), 'ctk-edit-'));
});

afterEach(() => {
  rmSync(tmpProject, { recursive: true, force: true });
});

describe('edit-guard: skill-registry trigger injection', () => {
  it('emits hint when file matches trigger glob', () => {
    writeRegistry('| go-testing | *_test.go | ~/skills/go | Go tests |');
    const r = run({ tool_input: { file_path: '/x/foo_test.go' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[ctk-skill-hint]');
    expect(r.stdout).toContain('go-testing');
  });

  it('no hint when no match', () => {
    writeRegistry('| go-testing | *_test.go | ~/skills/go | Go tests |');
    const r = run({ tool_input: { file_path: '/x/foo.ts' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('silent when no registry file', () => {
    const r = run({ tool_input: { file_path: '/x/foo.ts' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('toggle disables injection', () => {
    writeRegistry('| s | *.ts | p | s |');
    const r = run({ tool_input: { file_path: '/x/foo.ts' } }, { CTK_HOOK_EDIT_SKILL_INJECT: '0' });
    expect(r.stdout).toBe('');
  });

  it('matches multiple triggers (comma-separated)', () => {
    writeRegistry('| multi | *.ts, *.tsx | p | s |');
    const r = run({ tool_input: { file_path: '/x/a.tsx' } });
    expect(r.stdout).toContain('multi');
  });
});
