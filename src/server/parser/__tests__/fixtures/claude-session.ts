/**
 * Synthetic Claude Code session JSONL, split in two appends so the
 * characterization test also covers incremental re-sync.
 * Exercises every branch syncFile reads: meta, model counts, tool calls +
 * results, thinking, turn durations, hooks, file snapshots, permission mode.
 */

export const CLAUDE_SESSION_ID = 'char-claude-0001';
const CWD = '/home/dev/acme-app';
const BASE = { sessionId: CLAUDE_SESSION_ID, cwd: CWD, gitBranch: 'feat/x', version: '2.1.0' };

export const PART_1: object[] = [
  { type: 'permission-mode', permissionMode: 'acceptEdits', sessionId: CLAUDE_SESSION_ID },
  { type: 'custom-title', customTitle: 'Fix login bug', sessionId: CLAUDE_SESSION_ID },
  {
    ...BASE,
    type: 'user',
    uuid: 'u-1',
    parentUuid: null,
    timestamp: '2026-10-01T10:00:00.000Z',
    message: { role: 'user', content: 'Fix the login bug in auth.ts' },
  },
  {
    ...BASE,
    type: 'attachment',
    uuid: 'h-1',
    parentUuid: 'u-1',
    timestamp: '2026-10-01T10:00:00.500Z',
    attachment: {
      hookName: 'UserPromptSubmit',
      hookEvent: 'UserPromptSubmit',
      exitCode: 0,
      durationMs: 42,
      stdout: 'ok',
      stderr: '',
      command: 'hook.sh',
    },
  },
  {
    ...BASE,
    type: 'assistant',
    uuid: 'a-1',
    parentUuid: 'u-1',
    requestId: 'req-1',
    timestamp: '2026-10-01T10:00:05.000Z',
    message: {
      id: 'msg-1',
      model: 'claude-opus-4-7',
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: 'Need to read auth.ts first', signature: 'sig-1' },
        { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: `${CWD}/src/auth.ts` } },
      ],
      usage: {
        input_tokens: 1200,
        output_tokens: 80,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 300,
        cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 0 },
        service_tier: 'standard',
      },
    },
  },
  {
    ...BASE,
    type: 'user',
    uuid: 'u-2',
    parentUuid: 'a-1',
    sourceToolAssistantUUID: 'a-1',
    timestamp: '2026-10-01T10:00:06.000Z',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'export function login() {}' }],
    },
  },
  {
    ...BASE,
    type: 'system',
    subtype: 'turn_duration',
    uuid: 's-1',
    parentUuid: 'a-1',
    durationMs: 6000,
    timestamp: '2026-10-01T10:00:06.100Z',
  },
];

export const PART_2: object[] = [
  {
    ...BASE,
    type: 'assistant',
    uuid: 'a-2',
    parentUuid: 'u-2',
    requestId: 'req-2',
    timestamp: '2026-10-01T10:00:10.000Z',
    message: {
      id: 'msg-2',
      model: 'claude-opus-4-7',
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tu-2',
          name: 'Edit',
          input: { file_path: `${CWD}/src/auth.ts`, old_string: '{}', new_string: '{ return true; }' },
        },
        { type: 'tool_use', id: 'tu-3', name: 'Bash', input: { command: 'npm test' } },
      ],
      usage: { input_tokens: 300, output_tokens: 150, cache_read_input_tokens: 6200 },
    },
  },
  {
    ...BASE,
    type: 'user',
    uuid: 'u-3',
    parentUuid: 'a-2',
    sourceToolAssistantUUID: 'a-2',
    timestamp: '2026-10-01T10:00:15.000Z',
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu-2', content: 'edited' },
        { type: 'tool_result', tool_use_id: 'tu-3', content: '1 failing', is_error: true },
      ],
    },
  },
  {
    type: 'file-history-snapshot',
    messageId: 'a-2',
    isSnapshotUpdate: false,
    snapshot: {
      messageId: 'a-2',
      timestamp: '2026-10-01T10:00:15.500Z',
      trackedFileBackups: { 'src/auth.ts': { backupFileName: 'b1', version: 1 } },
    },
  },
  {
    ...BASE,
    type: 'user',
    uuid: 'u-4',
    parentUuid: 'u-3',
    timestamp: '2026-10-01T10:01:00.000Z',
    message: { role: 'user', content: 'Thanks, now summarize' },
  },
  {
    ...BASE,
    type: 'assistant',
    uuid: 'a-3',
    parentUuid: 'u-4',
    requestId: 'req-3',
    timestamp: '2026-10-01T10:01:03.000Z',
    message: {
      id: 'msg-3',
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Fixed login() and ran tests.' }],
      usage: { input_tokens: 50, output_tokens: 20 },
    },
  },
];
