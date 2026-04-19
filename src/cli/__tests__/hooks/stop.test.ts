import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const HOOK = resolve(__dirname, '../../../../claude-dist/hooks/stop.sh');

let tmpHome: string;
let transcript: string;

function writeTranscript(lines: string[]) {
  writeFileSync(transcript, lines.join('\n') + '\n');
}

function run(env: Record<string, string> = {}) {
  return spawnSync('bash', [HOOK], {
    input: JSON.stringify({ session_id: 'test-session', transcript_path: transcript }),
    env: { ...process.env, HOME: tmpHome, ...env },
    encoding: 'utf8',
  });
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'ctk-stop-home-'));
  mkdirSync(join(tmpHome, '.claude', 'state', 'claude-master-toolkit'), { recursive: true });
  transcript = join(tmpHome, 'tx.jsonl');
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('stop hook: save threshold', () => {
  it('silent below threshold', () => {
    writeTranscript(['{"name":"Edit"}', '{"name":"Edit"}']);
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('warns at default threshold 3 with zero saves', () => {
    writeTranscript(['{"name":"Edit"}', '{"name":"Edit"}', '{"name":"Edit"}']);
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('Session hint');
  });

  it('silent when mem_save present', () => {
    writeTranscript([
      '{"name":"Edit"}',
      '{"name":"Edit"}',
      '{"name":"Edit"}',
      '{"name":"mem_save"}',
    ]);
    const r = run();
    expect(r.stderr).toBe('');
  });

  it('configurable threshold via CTK_HOOK_SAVE_THRESHOLD', () => {
    writeTranscript(['{"name":"Edit"}', '{"name":"Edit"}']);
    const r = run({ CTK_HOOK_SAVE_THRESHOLD: '2' });
    expect(r.stderr).toContain('Session hint');
  });

  it('strict mode blocks with exit 2', () => {
    writeTranscript(['{"name":"Edit"}', '{"name":"Edit"}', '{"name":"Edit"}']);
    const r = run({ CTK_HOOK_SAVE_STRICT: '1' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Blocked Stop');
  });
});
