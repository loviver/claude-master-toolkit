import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const HOOK = resolve(__dirname, '../../../../claude-dist/hooks/user-prompt-submit.sh');

let tmpHome: string;
let tmpProject: string;

function run(input: unknown) {
  return spawnSync('bash', [HOOK], {
    input: JSON.stringify(input),
    env: {
      ...process.env,
      HOME: tmpHome,
      CLAUDE_PROJECT_DIR: tmpProject,
    },
    encoding: 'utf8',
  });
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'ctk-ups-home-'));
  tmpProject = mkdtempSync(join(tmpdir(), 'ctk-ups-proj-'));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpProject, { recursive: true, force: true });
});

describe('user-prompt-submit: sdd init guard', () => {
  it('emits init-required hint when sdd-* prompt + no marker', () => {
    const r = run({ prompt: '/sdd-new demo' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ctk init required');
  });

  it('no hint when init.marker exists', () => {
    mkdirSync(join(tmpProject, '.ctk'), { recursive: true });
    writeFileSync(join(tmpProject, '.ctk', 'init.marker'), 'ok');
    const r = run({ prompt: '/sdd-new demo' });
    expect(r.stdout).not.toContain('ctk init required');
  });

  it('no hint for non-sdd prompts', () => {
    const r = run({ prompt: 'hello world' });
    expect(r.stdout).not.toContain('ctk init required');
  });

  it('matches sdd-continue, sdd-ff, sdd-explore', () => {
    for (const cmd of ['sdd-continue', '/sdd-ff x', '/sdd-explore topic']) {
      const r = run({ prompt: cmd });
      expect(r.stdout).toContain('ctk init required');
    }
  });
});
