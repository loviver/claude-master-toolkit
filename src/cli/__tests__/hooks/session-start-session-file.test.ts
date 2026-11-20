import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

// Regression: ctk_lib_session_file resolved the newest transcript with
// `find | sort -rn | head -1`. Under the hook's `set -euo pipefail`, `head -1`
// closing the pipe early made `sort` die with SIGPIPE (141) once its output
// outgrew the pipe buffer, so the whole SessionStart hook exited 141 with no
// stderr ("SessionStart:startup hook failed — No stderr output").
const HOOK = resolve(__dirname, '../../../../claude-dist/hooks/session-start.sh');
const LIB = resolve(__dirname, '../../../../claude-dist/hooks/lib.sh');

// Enough long-named transcripts that `sort` output (~600KB) far exceeds the
// 64KB pipe buffer, making the SIGPIPE deterministic instead of timing-dependent.
const TRANSCRIPTS = 2500;

let tmpHome: string;
let tmpProject: string;
let projDir: string;
let newest: string;

function encode(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'ctk-sfile-home-'));
  tmpProject = mkdtempSync(join(tmpdir(), 'ctk-sfile-proj-'));
  projDir = join(tmpHome, '.claude', 'projects', encode(tmpProject));
  mkdirSync(projDir, { recursive: true });

  const pad = 'x'.repeat(200);
  const base = Date.now() / 1000 - 100_000;
  for (let i = 0; i < TRANSCRIPTS; i++) {
    const f = join(projDir, `${String(i).padStart(5, '0')}-${pad}.jsonl`);
    writeFileSync(f, '{}\n');
    utimesSync(f, base + i, base + i);
  }
  newest = join(projDir, `${String(TRANSCRIPTS - 1).padStart(5, '0')}-${pad}.jsonl`);
});

afterEach(() => {
  for (const d of [tmpHome, tmpProject]) rmSync(d, { recursive: true, force: true });
});

function env(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: tmpHome,
    CTK_HOME: join(tmpHome, '.ctk'),
    CLAUDE_PROJECT_DIR: tmpProject,
    CLAUDE_SESSION_ID: '',
    CTK_HOOK_REINDEX: '0',
  };
}

describe('ctk_lib_session_file — many transcripts', () => {
  it('returns the newest transcript and exits 0 under pipefail', () => {
    const r = spawnSync(
      'bash',
      ['-c', 'set -euo pipefail; source "$1"; f="$(ctk_lib_session_file)"; printf "%s" "$f"', '_', LIB],
      { env: env(), encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(newest);
  });

  it('session-start hook does not die with SIGPIPE (141)', () => {
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ cwd: tmpProject }),
      env: { ...env(), PATH: '/usr/bin:/bin' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
});
