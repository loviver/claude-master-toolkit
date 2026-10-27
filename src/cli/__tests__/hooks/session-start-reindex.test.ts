import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, chmodSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

// SessionStart heals a wiped (schema bump) or outdated index before the agent's first
// ctk_* query. Same contract as the PostToolUse reindex: ctk-active projects only,
// CTK_HOOK_REINDEX=0 disables, CTK_REINDEX_SYNC=1 runs inline for the assertion.
const HOOK = resolve(__dirname, '../../../../claude-dist/hooks/session-start.sh');

let tmpHome: string;
let tmpProject: string;
let tmpBin: string;
let sentinel: string;

function run(env: Record<string, string> = {}): { status: number | null; reindexed: boolean } {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ cwd: tmpProject }),
    env: {
      ...process.env,
      HOME: tmpHome,
      CTK_HOME: join(tmpHome, '.ctk'),
      CLAUDE_PROJECT_DIR: tmpProject,
      PATH: `${tmpBin}:${process.env.PATH}`,
      CTK_REINDEX_SYNC: '1',
      CTK_REINDEX_SENTINEL: sentinel,
      ...env,
    },
    encoding: 'utf8',
  });
  const log = existsSync(sentinel) ? readFileSync(sentinel, 'utf8') : '';
  return { status: r.status, reindexed: log.includes('index build') };
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'ctk-sstart-home-'));
  tmpProject = mkdtempSync(join(tmpdir(), 'ctk-sstart-proj-'));
  tmpBin = mkdtempSync(join(tmpdir(), 'ctk-sstart-bin-'));
  sentinel = join(tmpProject, 'ctk-called.txt');
  mkdirSync(join(tmpProject, '.ctk'), { recursive: true });
  writeFileSync(join(tmpProject, '.ctk', 'init.marker'), 'ok');
  const stub = join(tmpBin, 'ctk');
  writeFileSync(stub, `#!/usr/bin/env bash\necho "$@" >> "$CTK_REINDEX_SENTINEL"\n`);
  chmodSync(stub, 0o755);
});

afterEach(() => {
  for (const d of [tmpHome, tmpProject, tmpBin]) rmSync(d, { recursive: true, force: true });
});

describe('session-start hook — index refresh', () => {
  it('reindexes a ctk-active project', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.reindexed).toBe(true);
  });

  it('CTK_HOOK_REINDEX=0 disables it', () => {
    expect(run({ CTK_HOOK_REINDEX: '0' }).reindexed).toBe(false);
  });

  it('skips projects without init.marker', () => {
    rmSync(join(tmpProject, '.ctk', 'init.marker'));
    expect(run().reindexed).toBe(false);
  });
});
