import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'fs';
import { createCodexSessionSource } from '../codex.js';
import { claudeSessionSource } from '../claude.js';
import { sessionSources, sourceFor } from '../registry.js';
import type { NormalizedSession, SessionSource } from '../types.js';
import {
  CODEX_SESSION_ID,
  CODEX_ROLLOUT_NAME,
  PART_1,
  PART_2,
  SESSION_INDEX,
} from '../../__tests__/fixtures/codex-rollout.js';

const toJsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

describe('createCodexSessionSource', () => {
  let home: string;
  let dayDir: string;
  let rollout: string;
  let source: SessionSource;
  let session: NormalizedSession;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'ctk-src-codex-'));
    dayDir = join(home, 'sessions', '2026', '10', '26');
    mkdirSync(dayDir, { recursive: true });
    rollout = join(dayDir, CODEX_ROLLOUT_NAME);
    writeFileSync(rollout, toJsonl([...PART_1, ...PART_2]));
    writeFileSync(join(home, 'session_index.jsonl'), toJsonl(SESSION_INDEX));
    writeFileSync(join(home, 'history.jsonl'), '{}\n');
    source = createCodexSessionSource({ home });
    session = await source.read(rollout);
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it('identifies as the codex agent', () => {
    expect(source.agent).toBe('codex');
  });

  it('owns rollout files only', () => {
    expect(source.owns(rollout)).toBe(true);
    expect(source.owns(join(home, 'history.jsonl'))).toBe(false);
    expect(source.owns(join(home, 'session_index.jsonl'))).toBe(false);
    expect(source.owns('/x/.claude/projects/-a/s.jsonl')).toBe(false);
  });

  it('watches rollouts under <home>/sessions', () => {
    expect(source.watchGlobs()).toEqual([join(home, 'sessions', '**', 'rollout-*.jsonl')]);
  });

  it('discovers nested rollouts newest first', () => {
    const olderDir = join(home, 'sessions', '2026', '10', '25');
    mkdirSync(olderDir, { recursive: true });
    const older = join(olderDir, 'rollout-2026-10-25T09-00-00-older.jsonl');
    writeFileSync(older, toJsonl(PART_1));
    utimesSync(older, new Date('2026-10-25'), new Date('2026-10-25'));

    expect(source.discover()).toEqual([rollout, older]);
    rmSync(older);
  });

  it('defaults home to $CODEX_HOME, then ~/.codex', () => {
    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = '/opt/codex-home';
    try {
      expect(createCodexSessionSource().watchGlobs()).toEqual(['/opt/codex-home/sessions/**/rollout-*.jsonl']);
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prev;
    }
  });

  it('maps session meta from session_meta, turns and the session index', () => {
    expect(session.meta).toEqual({
      sessionId: CODEX_SESSION_ID,
      startedAt: '2026-10-26T18:06:38.500Z',
      lastActiveAt: '2026-10-26T18:07:31.200Z',
      cwd: '/home/dev/acme-app',
      gitBranch: 'feat/login',
      version: '0.164.0',
      primaryModel: 'gpt-5-codex',
      turnCount: 4,
      customTitle: 'Fix login bug',
      lastPrompt: 'Now wait for the test agent',
      entrypoint: 'vscode',
    });
    expect(session.projectPath).toBe('/home/dev/acme-app');
  });

  it('emits one token event per model response, priced on non-cached input', () => {
    expect(
      session.tokenEvents.map((e) => [e.uuid, e.model, e.usage, e.toolsUsed, e.stopReason, e.hasThinking]),
    ).toEqual([
      ['resp_0001', 'gpt-5-codex', { inputTokens: 2220, cacheReadTokens: 10752, outputTokens: 136, cacheCreationTokens: 0 }, ['exec'], 'tool_use', true],
      ['resp_0002', 'gpt-5-codex', { inputTokens: 338, cacheReadTokens: 12800, outputTokens: 75, cacheCreationTokens: 0 }, [], 'end_turn', false],
      ['resp_0003', 'gpt-5-codex-mini', { inputTokens: 400, cacheReadTokens: 0, outputTokens: 30, cacheCreationTokens: 0 }, ['wait'], 'tool_use', false],
      ['resp_0004', 'gpt-5-codex-mini', { inputTokens: 100, cacheReadTokens: 400, outputTokens: 10, cacheCreationTokens: 0 }, [], 'end_turn', false],
    ]);
    expect(session.tokenEvents[0]).toMatchObject({
      timestamp: '2026-10-26T18:06:41.300Z',
      messageId: 'resp_0001',
      isSidechain: false,
      semanticPhase: 'unknown',
      cwd: '/home/dev/acme-app',
    });
  });

  it('normalizes model output to text + tool_use content blocks', () => {
    expect(JSON.parse(session.tokenEvents[0].content!)).toEqual([
      { type: 'text', text: 'Reading auth.ts first.' },
      {
        type: 'tool_use',
        id: 'call_exec_1',
        name: 'exec',
        input: { input: "const r = await tools.exec_command({ cmd: 'cat src/auth.ts' });\ntext(r.output);" },
      },
    ]);
    expect(session.tokenEvents[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pairs each tool call with its output', () => {
    expect(session.tokenEvents[0].toolCalls).toEqual([
      expect.objectContaining({
        toolUseId: 'call_exec_1',
        toolName: 'exec',
        orderIdx: 0,
        resultContent: 'Script completed\nexport function login() {}',
        resultIsError: null,
      }),
    ]);
    expect(session.tokenEvents[2].toolCalls).toEqual([
      expect.objectContaining({
        toolUseId: 'call_wait_1',
        toolName: 'wait',
        inputJson: '{"timeout_ms":30000}',
        resultContent: 'tests passed',
      }),
    ]);
  });

  it('credits each turn duration to the last response of the turn', () => {
    expect([...session.turnDurations]).toEqual([
      ['resp_0002', 5200],
      ['resp_0004', 31200],
    ]);
  });

  it('binds prompts to the next response and tool outputs to the requesting one', () => {
    expect(session.userContent.map((c) => [c.assistantUuid, c.role, JSON.parse(c.raw)])).toEqual([
      ['resp_0001', 'user', [{ type: 'text', text: '<environment_context>\n  <cwd>/home/dev/acme-app</cwd>\n</environment_context>' }]],
      ['resp_0001', 'user', [{ type: 'text', text: 'Fix the login bug in auth.ts' }]],
      ['resp_0001', 'tool_result', [{ type: 'tool_result', tool_use_id: 'call_exec_1', content: 'Script completed\nexport function login() {}' }]],
      ['resp_0003', 'user', [{ type: 'text', text: 'Now wait for the test agent' }]],
      ['resp_0003', 'tool_result', [{ type: 'tool_result', tool_use_id: 'call_wait_1', content: 'tests passed' }]],
    ]);
  });

  it('has no hooks or file snapshots (Codex rollouts do not record them)', () => {
    expect(session.hooks).toEqual([]);
    expect(session.snapshots).toEqual([]);
  });

  it('labels spawned subagent rollouts and survives a missing session index', async () => {
    const file = join(dayDir, 'rollout-2026-10-26T12-30-00-sub.jsonl');
    const [meta, ...rest] = PART_1 as Array<{ payload: object }>;
    writeFileSync(
      file,
      toJsonl([{ ...meta, payload: { ...meta.payload, id: 'sub-1', source: { subagent: { thread_spawn: {} } } } }, ...rest]),
    );
    const bare = createCodexSessionSource({ home: join(home, 'missing') });

    const s = await bare.read(file);

    expect(s.meta).toMatchObject({ sessionId: 'sub-1', entrypoint: 'subagent', customTitle: undefined });
    rmSync(file);
  });
});

describe('session source registry with Codex', () => {
  it('routes rollouts to Codex before the broad Claude matcher', () => {
    expect(sessionSources.map((s) => s.agent)).toEqual(['codex', 'claude-code']);
    expect(sourceFor(`/home/u/.codex/sessions/2026/10/26/${CODEX_ROLLOUT_NAME}`)?.agent).toBe('codex');
    expect(sourceFor('/home/u/.claude/projects/-a/s.jsonl')).toBe(claudeSessionSource);
  });
});
