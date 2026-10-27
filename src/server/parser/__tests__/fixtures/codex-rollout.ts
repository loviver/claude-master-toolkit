/**
 * Synthetic Codex rollout mirroring the real `~/.codex/sessions/**\/rollout-*.jsonl`
 * shapes: model output items precede the `token_usage_record` of the response
 * that produced them; tool outputs and user messages follow it.
 * Two turns, four responses, split in two appends for incremental sync.
 */

export const CODEX_SESSION_ID = '01a17964-0000-7000-8000-00000000c0de';
export const CODEX_ROLLOUT_NAME = `rollout-2026-10-26T12-06-38-${CODEX_SESSION_ID}.jsonl`;
const CWD = '/home/dev/acme-app';
const T1 = 'turn-0001';
const T2 = 'turn-0002';

let ordinal = 0;
const line = (timestamp: string, type: string, payload: object, extra: object = {}) => ({
  timestamp,
  ordinal: ordinal++,
  type,
  payload,
  ...extra,
});
const pass = (turn_id: string) => ({ internal_chat_message_metadata_passthrough: { turn_id, create_time: 1 } });
const usage = (input: number, cached: number, output: number, reasoning = 0) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: 0,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
  total_tokens: input + output,
});
const usageRecord = (ts: string, turn_id: string, response_id: string, u: ReturnType<typeof usage>) =>
  line(ts, 'token_usage_record', {
    thread_id: CODEX_SESSION_ID,
    session_id: CODEX_SESSION_ID,
    turn_id,
    root_turn_id: turn_id,
    response_id,
    usage: u,
    turn_token_usage: u,
    thread_token_usage: u,
  });
const turnContext = (ts: string, turn_id: string, model: string) =>
  line(ts, 'turn_context', {
    turn_id,
    root_turn_id: turn_id,
    cwd: CWD,
    approval_policy: 'on-request',
    model,
    collaboration_mode: { mode: 'default', settings: { model, reasoning_effort: null } },
    summary: 'auto',
  });
const userMessage = (ts: string, turn_id: string, text: string, client_authored: boolean | null) =>
  line(
    ts,
    'response_item',
    { type: 'message', id: `m-${ordinal}`, role: 'user', content: [{ type: 'input_text', text }], ...pass(turn_id) },
    client_authored === null ? {} : { metadata: { client_authored, user_input_order: 0 } },
  );
const assistantMessage = (ts: string, turn_id: string, text: string) =>
  line(ts, 'response_item', {
    type: 'message',
    id: `m-${ordinal}`,
    role: 'assistant',
    status: 'completed',
    phase: 'final',
    content: [{ type: 'output_text', text, annotations: [], logprobs: [] }],
    ...pass(turn_id),
  });
const reasoning = (ts: string, turn_id: string) =>
  line(ts, 'response_item', {
    type: 'reasoning',
    id: `rs-${ordinal}`,
    summary: [],
    encrypted_content: 'gAAAA-opaque',
    internal_chat_message_metadata_passthrough: { turn_id },
  });

export const PART_1: object[] = [
  line('2026-10-26T18:06:38.500Z', 'session_meta', {
    session_id: CODEX_SESSION_ID,
    id: CODEX_SESSION_ID,
    timestamp: '2026-10-26T18:06:38.508Z',
    cwd: CWD,
    originator: 'codex-tui',
    cli_version: '0.164.0',
    source: 'vscode',
    model_provider: 'openai',
    base_instructions: { text: 'You are Codex.' },
    git: { commit_hash: 'abc123', branch: 'feat/login', repository_url: 'git@example.com:acme/app.git' },
  }),
  line('2026-10-26T18:06:39.000Z', 'event_msg', { type: 'task_started', turn_id: T1 }),
  line('2026-10-26T18:06:39.100Z', 'response_item', {
    type: 'message',
    id: 'dev-1',
    role: 'developer',
    content: [{ type: 'input_text', text: '<permissions instructions>' }],
    ...pass(T1),
  }),
  userMessage('2026-10-26T18:06:39.200Z', T1, `<environment_context>\n  <cwd>${CWD}</cwd>\n</environment_context>`, null),
  userMessage('2026-10-26T18:06:39.300Z', T1, 'Fix the login bug in auth.ts', false),
  line('2026-10-26T18:06:39.400Z', 'world_state', { state: {} }),
  turnContext('2026-10-26T18:06:39.500Z', T1, 'gpt-5-codex'),
  reasoning('2026-10-26T18:06:41.000Z', T1),
  assistantMessage('2026-10-26T18:06:41.100Z', T1, 'Reading auth.ts first.'),
  line('2026-10-26T18:06:41.200Z', 'response_item', {
    type: 'custom_tool_call',
    id: 'ctc-1',
    status: 'completed',
    call_id: 'call_exec_1',
    name: 'exec',
    input: "const r = await tools.exec_command({ cmd: 'cat src/auth.ts' });\ntext(r.output);",
    ...pass(T1),
  }),
  usageRecord('2026-10-26T18:06:41.300Z', T1, 'resp_0001', usage(12972, 10752, 136, 20)),
  line(
    '2026-10-26T18:06:42.000Z',
    'response_item',
    {
      type: 'custom_tool_call_output',
      id: 'ctco-1',
      call_id: 'call_exec_1',
      output: [{ type: 'input_text', text: 'Script completed\nexport function login() {}' }],
      ...pass(T1),
    },
    { metadata: { client_authored: false, fallback_token_limit_override: 10000 } },
  ),
  line('2026-10-26T18:06:42.050Z', 'event_msg', { type: 'token_count', info: null }),
  line('2026-10-26T18:06:42.100Z', 'event_msg', { type: 'item_completed', item: {} }),
  assistantMessage('2026-10-26T18:06:44.000Z', T1, 'login() returns nothing; it should return true.'),
  usageRecord('2026-10-26T18:06:44.100Z', T1, 'resp_0002', usage(13138, 12800, 75)),
  line('2026-10-26T18:06:44.200Z', 'event_msg', {
    type: 'task_complete',
    turn_id: T1,
    root_turn_id: T1,
    started_at: 1,
    completed_at: 2,
    duration_ms: 5200,
    last_agent_message: 'login() returns nothing; it should return true.',
  }),
];

export const PART_2: object[] = [
  line('2026-10-26T18:07:00.000Z', 'event_msg', { type: 'task_started', turn_id: T2 }),
  userMessage('2026-10-26T18:07:00.100Z', T2, 'Now wait for the test agent', false),
  turnContext('2026-10-26T18:07:00.200Z', T2, 'gpt-5-codex-mini'),
  line('2026-10-26T18:07:02.000Z', 'response_item', {
    type: 'function_call',
    id: 'fc-1',
    status: 'completed',
    name: 'wait',
    arguments: '{"timeout_ms":30000}',
    call_id: 'call_wait_1',
    ...pass(T2),
  }),
  usageRecord('2026-10-26T18:07:02.100Z', T2, 'resp_0003', usage(400, 0, 30)),
  line('2026-10-26T18:07:30.000Z', 'response_item', {
    type: 'function_call_output',
    id: 'fco-1',
    call_id: 'call_wait_1',
    output: 'tests passed',
    ...pass(T2),
  }),
  assistantMessage('2026-10-26T18:07:31.000Z', T2, 'Tests pass.'),
  usageRecord('2026-10-26T18:07:31.100Z', T2, 'resp_0004', usage(500, 400, 10)),
  line('2026-10-26T18:07:31.200Z', 'event_msg', {
    type: 'task_complete',
    turn_id: T2,
    root_turn_id: T2,
    started_at: 3,
    completed_at: 4,
    duration_ms: 31200,
    last_agent_message: 'Tests pass.',
  }),
];

/** `~/.codex/session_index.jsonl`: thread names, last entry per id wins. */
export const SESSION_INDEX: object[] = [
  { id: CODEX_SESSION_ID, thread_name: 'Login bug', updated_at: '2026-10-26T18:06:40Z' },
  { id: 'someone-else', thread_name: 'Other', updated_at: '2026-10-26T18:06:41Z' },
  { id: CODEX_SESSION_ID, thread_name: 'Fix login bug', updated_at: '2026-10-26T18:07:40Z' },
];
