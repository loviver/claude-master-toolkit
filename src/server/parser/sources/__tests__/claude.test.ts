import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { claudeSessionSource } from '../claude.js';
import { sessionSources, sourceFor } from '../registry.js';
import { CLAUDE_SESSION_ID, PART_1, PART_2 } from '../../__tests__/fixtures/claude-session.js';

const toJsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

describe('claudeSessionSource', () => {
  let dir: string;
  let projectDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ctk-src-claude-'));
    projectDir = join(dir, 'projects', '-home-dev-acme-app');
    mkdirSync(projectDir, { recursive: true });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('identifies as the claude-code agent', () => {
    expect(claudeSessionSource.agent).toBe('claude-code');
  });

  it('owns JSONL files only', () => {
    expect(claudeSessionSource.owns('/x/projects/-a/s.jsonl')).toBe(true);
    expect(claudeSessionSource.owns('/x/projects/-a/s/subagents/agent-1.jsonl')).toBe(true);
    expect(claudeSessionSource.owns('/x/projects/-a/notes.md')).toBe(false);
  });

  it('watches every JSONL under ~/.claude/projects', () => {
    expect(claudeSessionSource.watchGlobs()).toEqual([
      expect.stringMatching(/\.claude\/projects\/\*\*\/\*\.jsonl$/),
    ]);
  });

  it('reads a session file into the normalized shape', async () => {
    const file = join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`);
    writeFileSync(file, toJsonl([...PART_1, ...PART_2]));

    const s = await claudeSessionSource.read(file);

    expect(s.meta.sessionId).toBe(CLAUDE_SESSION_ID);
    expect(s.meta.primaryModel).toBe('claude-opus-4-7');
    expect(s.projectPath).toBe('/home/dev/acme-app');
    expect(s.tokenEvents.map((e) => e.uuid)).toEqual(['a-1', 'a-2', 'a-3']);
    expect(s.turnDurations.get('a-1')).toBe(6000);
    expect(s.hooks.map((h) => h.hookName)).toEqual(['UserPromptSubmit']);
    expect(s.snapshots.map((x) => x.messageId)).toEqual(['a-2']);
    expect(s.userContent.map((c) => [c.assistantUuid, c.role])).toEqual([
      ['a-1', 'user'],
      ['a-1', 'tool_result'],
      ['a-2', 'tool_result'],
      ['a-3', 'user'],
    ]);
  });

  it('falls back to the encoded project dir when events carry no cwd', async () => {
    const file = join(projectDir, 'no-cwd.jsonl');
    writeFileSync(file, toJsonl([{ type: 'user', sessionId: 'no-cwd', message: { content: 'hi' } }]));

    const s = await claudeSessionSource.read(file);

    expect(s.projectPath).toBe('/home/dev/acme/app');
  });
});

describe('session source registry', () => {
  it('registers the Claude source', () => {
    expect(sessionSources).toContain(claudeSessionSource);
  });

  it('resolves the source that owns a file', () => {
    expect(sourceFor('/x/projects/-a/s.jsonl')).toBe(claudeSessionSource);
    expect(sourceFor('/x/notes.md')).toBeUndefined();
  });
});
