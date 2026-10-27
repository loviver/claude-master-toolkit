import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const HOOKS = join(__dirname, '..', '..', '..', '..', 'claude-dist', 'hooks');
let tmp: string;
let stub: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ctk-shim-'));
  stub = join(tmp, 'hook.js');
  // Echo argv + stdin so we can see exactly what the shim handed to the TS runtime.
  writeFileSync(stub, "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify({argv:process.argv.slice(2),stdin:d})));");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const run = (script: string, input: string, env: Record<string, string> = {}) =>
  spawnSync('bash', [join(HOOKS, script)], {
    input,
    encoding: 'utf8',
    env: { ...process.env, HOME: tmp, CTK_HOME: join(tmp, 'ctk'), CLAUDE_PROJECT_DIR: tmp, ...env },
  });

describe('CTK_HOOKS=ts shim', () => {
  it.each([
    ['session-start.sh', 'session-start'],
    ['user-prompt-submit.sh', 'user-prompt-submit'],
    ['pre-tool-use.sh', 'pre-tool-use'],
    ['post-tool-use.sh', 'post-tool-use'],
    ['stop.sh', 'stop'],
    ['pre-compact.sh', 'pre-compact'],
    ['session-end.sh', 'session-end'],
    ['subagent-start.sh', 'subagent-start'],
    ['subagent-stop.sh', 'subagent-stop'],
  ])('%s delegates to the TS runtime with its event and the untouched stdin', (script, event) => {
    const payload = '{"x":1}';
    const r = run(script, payload, { CTK_HOOKS: 'ts', CTK_HOOK_BIN: stub });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ argv: [event, '--agent', 'claude-code'], stdin: payload });
  });

  it('without the flag the bash hook runs as before (stub never called)', () => {
    const r = run('pre-compact.sh', '{"compaction_reason":"x"}', { CTK_HOOK_BIN: stub });
    expect(r.stdout).toContain('Compaction');
    expect(r.stdout).not.toContain('"argv"');
  });

  it('flag set but runtime missing => falls back to bash', () => {
    const r = run('pre-compact.sh', '{}', { CTK_HOOKS: 'ts', CTK_HOOK_BIN: join(tmp, 'nope.js') });
    expect(r.stdout).toContain('Compaction');
  });
});
