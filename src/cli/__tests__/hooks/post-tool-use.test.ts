import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, chmodSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

// PostToolUse incremental reindex: after an Edit/Write to a source file in a
// ctk-active project, fire `ctk index build` so the AST index (which ODD risk
// reads) doesn't go stale. Runs detached in production; CTK_REINDEX_SYNC=1 makes
// it inline so the test can observe the call deterministically.
const HOOK = resolve(__dirname, '../../../../claude-dist/hooks/post-tool-use.sh');

let tmpHome: string;
let tmpProject: string;
let tmpBin: string;
let sentinel: string;

function run(
  payload: object,
  env: Record<string, string> = {},
): { status: number | null; called: boolean; sentinel: string } {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload),
    env: {
      ...process.env,
      HOME: tmpHome,
      CLAUDE_PROJECT_DIR: tmpProject,
      PATH: `${tmpBin}:${process.env.PATH}`,
      CTK_REINDEX_SYNC: '1', // run the build inline for deterministic assertion
      CTK_REINDEX_SENTINEL: sentinel,
      ...env,
    },
    encoding: 'utf8',
  });
  const called = existsSync(sentinel);
  return {
    status: r.status,
    called,
    sentinel: called ? readFileSync(sentinel, 'utf8') : '',
  };
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'ctk-posttool-home-'));
  tmpProject = mkdtempSync(join(tmpdir(), 'ctk-posttool-proj-'));
  tmpBin = mkdtempSync(join(tmpdir(), 'ctk-posttool-bin-'));
  sentinel = join(tmpProject, 'ctk-called.txt');

  // ctk-active project.
  mkdirSync(join(tmpProject, '.ctk'), { recursive: true });
  writeFileSync(join(tmpProject, '.ctk', 'init.marker'), 'ok');

  // Stub `ctk` on PATH: records its args to the sentinel the hook passes through.
  const stub = join(tmpBin, 'ctk');
  writeFileSync(stub, `#!/usr/bin/env bash\necho "$@" >> "$CTK_REINDEX_SENTINEL"\n`);
  chmodSync(stub, 0o755);
});

afterEach(() => {
  for (const d of [tmpHome, tmpProject, tmpBin]) rmSync(d, { recursive: true, force: true });
});

function editOf(file: string): object {
  return { tool_name: 'Edit', cwd: tmpProject, tool_input: { file_path: file } };
}

describe('post-tool-use hook — incremental reindex', () => {
  it('reindexes after an Edit to a source file in a ctk-active project', () => {
    const r = run(editOf(join(tmpProject, 'src', 'x.ts')));
    expect(r.status).toBe(0);
    expect(r.called).toBe(true);
    expect(r.sentinel).toContain('index build');
  });

  it('does nothing for a non-source file', () => {
    const r = run(editOf(join(tmpProject, 'README.md')));
    expect(r.status).toBe(0);
    expect(r.called).toBe(false);
  });

  it('does nothing for a non-edit tool', () => {
    const r = run({ tool_name: 'Bash', cwd: tmpProject, tool_input: { command: 'ls' } });
    expect(r.called).toBe(false);
  });

  it('is a no-op when CTK_HOOK_REINDEX=0', () => {
    const r = run(editOf(join(tmpProject, 'src', 'x.ts')), { CTK_HOOK_REINDEX: '0' });
    expect(r.called).toBe(false);
  });

  it('is a no-op when the project is not ctk-active (no init.marker)', () => {
    rmSync(join(tmpProject, '.ctk', 'init.marker'));
    const r = run(editOf(join(tmpProject, 'src', 'x.ts')));
    expect(r.called).toBe(false);
  });
});
