import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { HookEvent } from '../../runtime/types.js';
import { stopHandler } from '../stop.js';
import { preCompactHandler } from '../pre-compact.js';
import { sessionEndHandler } from '../session-end.js';
import { postToolUseHandler } from '../post-tool-use.js';
import { subagentStartHandler } from '../subagent-start.js';
import { subagentStopHandler } from '../subagent-stop.js';
import { userPromptSubmitHandler } from '../user-prompt-submit.js';
import { preToolUseHandler } from '../pre-tool-use.js';
import { sessionStartHandler } from '../session-start.js';
import { ctkPaths } from '../../../shared/paths/ctk-home-paths.js';

let tmp: string;
const KEYS = [
  'CTK_HOME', 'HOME', 'PATH', 'CTK_PORT', 'CTK_HOOK_SAVE_THRESHOLD', 'CTK_HOOK_SAVE_STRICT',
  'CTK_HOOK_REINDEX', 'CTK_REINDEX_SYNC', 'CTK_REINDEX_SENTINEL', 'CTK_HOOK_PERSONA_INJECT',
  'CTK_HOOK_REGISTRY_INJECT', 'CTK_HOOK_SUBAGENT_NAG', 'CTK_HOOK_AGENT_STRICT', 'CTK_PERSONA_FILE',
  'CTK_HOOK_EDIT_SKILL_INJECT', 'CLAUDE_CONTEXT_WINDOW',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  tmp = mkdtempSync(join(tmpdir(), 'ctk-hooks-'));
  process.env['CTK_HOME'] = join(tmp, 'ctk');
  process.env['HOME'] = tmp;
  process.env['CTK_PORT'] = '1'; // nothing listens: sync fails fast
  delete process.env['CLAUDE_CONTEXT_WINDOW'];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

const ev = (over: Partial<HookEvent>): HookEvent => ({
  agent: 'claude-code',
  event: 'Stop',
  sessionId: 'sid1',
  cwd: tmp,
  raw: {},
  ...over,
});

function transcript(lines: unknown[]): string {
  const p = join(tmp, 't.jsonl');
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}
const tool = (name: string) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name }] } });
const toolLine = (name: string) => `{"name":"${name}"}`;
function rawTranscript(names: string[]): string {
  const p = join(tmp, 't.jsonl');
  writeFileSync(p, names.map(toolLine).join('\n') + '\n');
  return p;
}

describe('stopHandler', () => {
  it('silent below threshold', async () => {
    const t = rawTranscript(['Edit', 'Edit']);
    expect(await stopHandler(ev({ transcriptPath: t }))).toEqual({ kind: 'noop' });
  });

  it('hints at >=3 edits with no saves, once', async () => {
    const t = rawTranscript(['Edit', 'Write', 'MultiEdit']);
    const first = await stopHandler(ev({ transcriptPath: t }));
    expect(first.kind).toBe('message');
    expect((first as { text: string }).text).toContain('Session hint');
    expect(await stopHandler(ev({ transcriptPath: t }))).toEqual({ kind: 'noop' });
  });

  it('silent when mem_save or ctk_record present', async () => {
    expect(await stopHandler(ev({ transcriptPath: rawTranscript(['Edit', 'Edit', 'Edit', 'mem_save']) }))).toEqual({ kind: 'noop' });
    expect(await stopHandler(ev({ sessionId: 'other', transcriptPath: rawTranscript(['Edit', 'Edit', 'Edit', 'ctk_record']) }))).toEqual({ kind: 'noop' });
  });

  it('honours CTK_HOOK_SAVE_THRESHOLD', async () => {
    process.env['CTK_HOOK_SAVE_THRESHOLD'] = '1';
    expect((await stopHandler(ev({ transcriptPath: rawTranscript(['Edit']) }))).kind).toBe('message');
  });

  it('strict => block', async () => {
    process.env['CTK_HOOK_SAVE_STRICT'] = '1';
    const r = await stopHandler(ev({ transcriptPath: rawTranscript(['Edit', 'Edit', 'Edit']) }));
    expect(r.kind).toBe('block');
    expect((r as { reason: string }).reason).toContain('✗ Blocked Stop');
  });

  it('no transcript => noop', async () => {
    expect(await stopHandler(ev({}))).toEqual({ kind: 'noop' });
  });

  it('nag state lives under hookState(agent, session)', async () => {
    await stopHandler(ev({ transcriptPath: rawTranscript(['Edit', 'Edit', 'Edit']) }));
    expect(existsSync(join(ctkPaths.hookState('claude-code', 'sid1'), 'nagged'))).toBe(true);
  });
});

describe('preCompactHandler', () => {
  it('reads trigger (not compaction_reason)', () => {
    const r = preCompactHandler(ev({ event: 'PreCompact', trigger: 'manual' }));
    expect((r as { text: string }).text).toContain('Compaction (manual) imminent');
    expect((r as { text: string }).text).toContain('mem_session({ action: "summary", content })');
  });
  it('unknown when trigger missing', () => {
    expect((preCompactHandler(ev({ event: 'PreCompact' })) as { text: string }).text).toContain('(unknown)');
  });
});

describe('sessionEndHandler', () => {
  it('clear/logout purge this session state only', async () => {
    const mine = ctkPaths.hookState('claude-code', 'sid1');
    const other = ctkPaths.hookState('claude-code', 'sid2');
    const codex = ctkPaths.hookState('codex', 'sid1');
    for (const d of [mine, other, codex]) {
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'nagged'), '');
    }
    await sessionEndHandler(ev({ event: 'SessionEnd', reason: 'clear' }));
    expect(existsSync(mine)).toBe(false);
    expect(existsSync(other)).toBe(true);
    expect(existsSync(codex)).toBe(true);
  });
  it('other reasons keep state', async () => {
    const mine = ctkPaths.hookState('claude-code', 'sid1');
    mkdirSync(mine, { recursive: true });
    await sessionEndHandler(ev({ event: 'SessionEnd', reason: 'other' }));
    expect(existsSync(mine)).toBe(true);
  });
});

describe('postToolUseHandler (reindex)', () => {
  let sentinel: string;
  beforeEach(() => {
    const bin = join(tmp, 'bin');
    mkdirSync(bin);
    sentinel = join(tmp, 'sentinel');
    const stub = join(bin, 'ctk');
    writeFileSync(stub, '#!/bin/sh\necho "$@" >> "$CTK_REINDEX_SENTINEL"\n');
    chmodSync(stub, 0o755);
    process.env['PATH'] = `${bin}:${saved['PATH']}`;
    process.env['CTK_REINDEX_SENTINEL'] = sentinel;
    process.env['CTK_REINDEX_SYNC'] = '1';
    mkdirSync(join(tmp, '.ctk'));
    writeFileSync(join(tmp, '.ctk', 'init.marker'), '');
  });
  const edit = (file: string, kind: 'edit' | 'write' = 'edit') =>
    ev({ event: 'PostToolUse', tool: { canonical: kind, rawName: 'Edit', input: {}, filePaths: [file] } });

  it('reindexes after a source edit', async () => {
    await postToolUseHandler(edit(join(tmp, 'a.ts')));
    expect(readFileSync(sentinel, 'utf8')).toContain('index build');
  });
  it.each(['a.md', 'a.json'])('ignores non-source %s', async (f) => {
    await postToolUseHandler(edit(join(tmp, f)));
    expect(existsSync(sentinel)).toBe(false);
  });
  it('ignores non edit tools', async () => {
    await postToolUseHandler(ev({ event: 'PostToolUse', tool: { canonical: 'shell', rawName: 'Bash', input: {} } }));
    expect(existsSync(sentinel)).toBe(false);
  });
  it('CTK_HOOK_REINDEX=0 disables', async () => {
    process.env['CTK_HOOK_REINDEX'] = '0';
    await postToolUseHandler(edit(join(tmp, 'a.ts')));
    expect(existsSync(sentinel)).toBe(false);
  });
  it('needs init.marker', async () => {
    rmSync(join(tmp, '.ctk', 'init.marker'));
    await postToolUseHandler(edit(join(tmp, 'a.ts')));
    expect(existsSync(sentinel)).toBe(false);
  });
});

describe('subagent handlers', () => {
  it('start injects persona + registry', () => {
    mkdirSync(join(tmp, '.claude'), { recursive: true });
    writeFileSync(join(tmp, '.claude', 'persona.md'), 'I am persona');
    mkdirSync(join(tmp, '.ctk'));
    writeFileSync(join(tmp, '.ctk', 'skill-registry.md'), '| Name |');
    const r = subagentStartHandler(ev({ event: 'SubagentStart' }));
    const t = (r as { text: string }).text;
    expect(t).toContain('[ctk-persona]\nI am persona');
    expect(t).toContain('[ctk-skills] registry at .ctk/skill-registry.md');
  });
  it('start: toggles and empty', () => {
    expect(subagentStartHandler(ev({ event: 'SubagentStart' }))).toEqual({ kind: 'noop' });
    mkdirSync(join(tmp, '.claude'), { recursive: true });
    writeFileSync(join(tmp, '.claude', 'persona.md'), 'p');
    process.env['CTK_HOOK_PERSONA_INJECT'] = '0';
    expect(subagentStartHandler(ev({ event: 'SubagentStart' }))).toEqual({ kind: 'noop' });
  });
  it('stop is opt-in and only for apply-like agents', () => {
    expect(subagentStopHandler(ev({ event: 'SubagentStop', agentType: 'sdd-apply' }))).toEqual({ kind: 'noop' });
    process.env['CTK_HOOK_SUBAGENT_NAG'] = '1';
    expect((subagentStopHandler(ev({ event: 'SubagentStop', agentType: 'sdd-apply' })) as { text: string }).text).toContain(
      "Sub-agent 'sdd-apply' finished",
    );
    expect(subagentStopHandler(ev({ event: 'SubagentStop', agentType: 'Explore' }))).toEqual({ kind: 'noop' });
  });
});

describe('userPromptSubmitHandler', () => {
  const up = (prompt: string, over: Partial<HookEvent> = {}) =>
    ev({ event: 'UserPromptSubmit', prompt, ...over });

  it('sdd prompt without init.marker => init hint; with marker => none', async () => {
    const r = await userPromptSubmitHandler(up('/sdd-new foo'));
    expect((r as { text: string }).text).toContain('ctk init required');
    mkdirSync(join(tmp, '.ctk'));
    writeFileSync(join(tmp, '.ctk', 'init.marker'), '');
    expect(await userPromptSubmitHandler(up('/sdd-new foo'))).toEqual({ kind: 'noop' });
    expect(await userPromptSubmitHandler(up('hello'))).toEqual({ kind: 'noop' });
  });

  it('plan intent => plan-designer hint', async () => {
    const r = await userPromptSubmitHandler(up('diseña un plan para X'));
    expect((r as { text: string }).text).toContain('load plan-designer');
  });

  it('context warning once per level from the payload transcript', async () => {
    const t = transcript([
      { type: 'assistant', message: { usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 150_000 } } },
    ]);
    const r = await userPromptSubmitHandler(up('hi', { transcriptPath: t, model: 'claude-sonnet-5-5' }));
    expect((r as { text: string }).text).toContain('Context Guardian: threshold crossed');
    expect(await userPromptSubmitHandler(up('hi', { transcriptPath: t, model: 'claude-sonnet-5-5' }))).toEqual({ kind: 'noop' });
  });

  it('/task persists name when git clean-or-absent (not a repo => clean)', async () => {
    const r = await userPromptSubmitHandler(up('/task my-task'));
    expect((r as { text: string }).text).toBe('✓ Task: my-task');
    expect(readFileSync(join(tmp, '.ctk', 'current-task.txt'), 'utf8').trim()).toBe('my-task');
  });
});

describe('preToolUseHandler routing', () => {
  const shell = (command: string) =>
    ev({ event: 'PreToolUse', tool: { canonical: 'shell', rawName: 'Bash', input: {}, command } });

  it('shell commit with attribution => block', async () => {
    expect((await preToolUseHandler(shell('git commit -m "Co-Authored-By: x"'))).kind).toBe('block');
  });
  it('agent => agent guard', async () => {
    const r = await preToolUseHandler(
      ev({ event: 'PreToolUse', tool: { canonical: 'agent', rawName: 'Agent', input: {}, subagent: { type: 'x', prompt: 'p' } } }),
    );
    expect(r.kind).toBe('context');
  });
  it('edit => skill hint from SKILL.md frontmatter paths', async () => {
    mkdirSync(join(tmp, 'sk'));
    writeFileSync(join(tmp, 'sk', 'SKILL.md'), '---\nname: react-ui\ndescription: d\npaths: src/**/*.tsx, **/*.stories.tsx\n---\nbody');
    mkdirSync(join(tmp, '.ctk'));
    writeFileSync(
      join(tmp, '.ctk', 'skill-registry.md'),
      `| Name | Source | Description | Path |\n|---|---|---|---|\n| react-ui | project | d | ${join(tmp, 'sk', 'SKILL.md')} |\n`,
    );
    const r = await preToolUseHandler(
      ev({ event: 'PreToolUse', tool: { canonical: 'edit', rawName: 'Edit', input: {}, filePaths: [join(tmp, 'src/a/B.tsx')] } }),
    );
    expect((r as { text: string }).text).toContain('load react-ui (trigger: src/**/*.tsx)');
  });
  it('CTK_HOOK_EDIT_SKILL_INJECT=0 disables skill hints', async () => {
    process.env['CTK_HOOK_EDIT_SKILL_INJECT'] = '0';
    expect(
      await preToolUseHandler(
        ev({ event: 'PreToolUse', tool: { canonical: 'edit', rawName: 'Edit', input: {}, filePaths: [join(tmp, 'a.tsx')] } }),
      ),
    ).toEqual({ kind: 'noop' });
  });
});

describe('sessionStartHandler', () => {
  it('warns about the previous session in this cwd when >=60%', async () => {
    const dir = join(tmp, '.claude', 'projects', tmp.replace(/\//g, '-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'prev.jsonl'),
      JSON.stringify({ message: { usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 150_000 } } }) + '\n',
    );
    process.env['PATH'] = '/nonexistent'; // no ctk => no reminders
    const r = await sessionStartHandler(ev({ event: 'SessionStart', sessionId: 'new-one' }));
    const t = (r as { text: string }).text;
    expect(t).toContain('Context Guardian — prior session in this project');
    expect(t).toContain('Recommendation: /compact (continuing same work) or /clear (new task)');
  });
  it('does not count the current session as "prior"', async () => {
    const dir = join(tmp, '.claude', 'projects', tmp.replace(/\//g, '-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cur.jsonl'), JSON.stringify({ message: { usage: { input_tokens: 190_000 } } }) + '\n');
    process.env['PATH'] = '/nonexistent';
    expect(await sessionStartHandler(ev({ event: 'SessionStart', sessionId: 'cur' }))).toEqual({ kind: 'noop' });
  });
});
