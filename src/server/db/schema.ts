import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';

// ── Sessions ──

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  projectPath: text('project_path').notNull(),
  startedAt: integer('started_at').notNull(),
  lastActiveAt: integer('last_active_at').notNull(),
  primaryModel: text('primary_model').notNull().default('unknown'),
  gitBranch: text('git_branch'),
  version: text('version'),
  turnCount: integer('turn_count').notNull().default(0),
  totalInputTokens: integer('total_input_tokens').notNull().default(0),
  totalOutputTokens: integer('total_output_tokens').notNull().default(0),
  totalCacheReadTokens: integer('total_cache_read_tokens').notNull().default(0),
  totalCacheCreationTokens: integer('total_cache_creation_tokens').notNull().default(0),
  totalCostUsd: real('total_cost_usd').notNull().default(0),
  jsonlFile: text('jsonl_file').notNull(),
});

// ── Token Events (per assistant turn) ──

export const tokenEvents = sqliteTable('token_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  timestamp: integer('timestamp').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  // Enriched columns
  toolsUsed: text('tools_used'),          // JSON array: '["Read","Grep"]'
  stopReason: text('stop_reason'),         // "end_turn" | "tool_use" | "max_tokens"
  isSidechain: integer('is_sidechain', { mode: 'boolean' }).default(false),
  parentUuid: text('parent_uuid'),
  semanticPhase: text('semantic_phase'),   // "exploration" | "implementation" | "testing" | "unknown"
  agentRole: text('agent_role'),           // "explorer" | "implementer" | "reviewer" | "orchestrator" | null
  // v7 enrichment (nullable; older rows lack these)
  uuid: text('uuid'),                      // assistant event uuid (for joins w/ hooks/file-changes)
  messageId: text('message_id'),
  requestId: text('request_id'),
  slug: text('slug'),
  apiErrorStatus: text('api_error_status'),
  isApiError: integer('is_api_error', { mode: 'boolean' }).default(false),
  serviceTier: text('service_tier'),
  speed: text('speed'),
  cache1hTokens: integer('cache_1h_tokens').default(0),
  cache5mTokens: integer('cache_5m_tokens').default(0),
  webSearchCount: integer('web_search_count').default(0),
  webFetchCount: integer('web_fetch_count').default(0),
  iterationsCount: integer('iterations_count').default(0),
  durationMs: integer('duration_ms'),
  permissionMode: text('permission_mode'),
  hasThinking: integer('has_thinking', { mode: 'boolean' }).default(false),
  // v9: richer drawer/graph surface
  thinkingText: text('thinking_text'),
  thinkingSignature: text('thinking_signature'),
  promptId: text('prompt_id'),
  cwd: text('cwd'),
  gitBranch: text('git_branch'),
  isMeta: integer('is_meta', { mode: 'boolean' }).default(false),
  isCompactSummary: integer('is_compact_summary', { mode: 'boolean' }).default(false),
  userType: text('user_type'),
});

// ── Structured tool_use/tool_result per turn (v9) ──

export const turnToolCalls = sqliteTable('turn_tool_calls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id')
    .notNull()
    .references(() => tokenEvents.id, { onDelete: 'cascade' }),
  toolUseId: text('tool_use_id').notNull(),
  toolName: text('tool_name').notNull(),
  orderIdx: integer('order_idx').notNull().default(0),
  inputJson: text('input_json'),         // raw JSON, may be truncated
  resultIsError: integer('result_is_error', { mode: 'boolean' }),
  resultContent: text('result_content'), // truncated ~4KB
  resultStderr: text('result_stderr'),
  resultStdout: text('result_stdout'),
  resultExitCode: integer('result_exit_code'),
});

// ── Hook attachments (session-level, optionally tied to a turn) ──

export const turnHooks = sqliteTable('turn_hooks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  eventId: integer('event_id'),            // nullable; hook may precede first turn
  hookName: text('hook_name').notNull(),
  hookEvent: text('hook_event').notNull(),
  exitCode: integer('exit_code'),
  durationMs: integer('duration_ms'),
  stdout: text('stdout'),
  stderr: text('stderr'),
  command: text('command'),
  timestamp: integer('timestamp').notNull(),
});

// ── File changes per turn (from file-history-snapshot) ──

export const turnFileChanges = sqliteTable('turn_file_changes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  eventId: integer('event_id'),            // nullable if we can't resolve
  messageId: text('message_id').notNull(),
  filePath: text('file_path').notNull(),
  isSnapshotUpdate: integer('is_snapshot_update', { mode: 'boolean' }).default(false),
  timestamp: integer('timestamp'),
});

// ── Turn Content (heavy payload, separate table) ──

export const turnContent = sqliteTable('turn_content', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  eventId: integer('event_id')
    .notNull()
    .references(() => tokenEvents.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),            // 'user' | 'assistant'
  content: text('content').notNull(),      // JSON stringified
  contentHash: text('content_hash').notNull(),
  byteSize: integer('byte_size').notNull(),
});

// ── Pandorica v2 Memories (mem_* tools) ──

export const memoriesV2 = sqliteTable('memories_v2', {
  id: text('id').primaryKey(),
  sessionId: text('session_id'),

  // Engram-compatible core
  title: text('title').notNull(),
  type: text('type'),        // decision | bugfix | architecture | pattern | preference | reference | note | session_summary
  what: text('what'),
  why: text('why'),
  where_: text('where_'),    // `where` is reserved
  learned: text('learned'),
  topicKey: text('topic_key'),

  // CTK cost-correlation enrichment
  model: text('model'),
  phase: text('phase'),
  tokensInput: integer('tokens_input'),
  tokensOutput: integer('tokens_output'),
  cacheHitPct: real('cache_hit_pct'),
  costUsd: real('cost_usd'),

  // Reuse / ROI tracking
  accessCount: integer('access_count').notNull().default(0),
  costSavedUsd: real('cost_saved_usd').notNull().default(0),

  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at'),
  accessedAt: integer('accessed_at'),

  // Legacy-preserving columns (REST API compatibility)
  scope: text('scope').notNull().default('project'),  // project | personal
  projectPath: text('project_path'),
  description: text('description'),
  filePath: text('file_path'),
});

export const memorySearches = sqliteTable('memory_searches', {
  id: text('id').primaryKey(),
  sessionId: text('session_id'),
  memoryId: text('memory_id'),
  query: text('query').notNull(),
  rank: real('rank'),
  createdAt: integer('created_at').notNull(),
});

// ── Settings (generic key/value) ──

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ── Sync State (track JSONL parse progress) ──

export const syncState = sqliteTable('sync_state', {
  filePath: text('file_path').primaryKey(),
  lastByteOffset: integer('last_byte_offset').notNull().default(0),
  lastModified: integer('last_modified').notNull().default(0),
});

// ── Symbol Index (semantic AST index for token-efficient agent tools) ──

export const symbols = sqliteTable('symbols', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectPath: text('project_path').notNull(),
  file: text('file').notNull(),
  symbol: text('symbol').notNull(),
  kind: text('kind').notNull(),              // class|function|method|type|interface|const|enum
  signature: text('signature'),              // "validateBlob(b: Blob): Result"
  summary: text('summary'),                  // 1-2 lines, optional LLM-enriched
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  exported: integer('exported', { mode: 'boolean' }).notNull().default(false),
  deps: text('deps'),                        // JSON array of identifier names referenced
  callers: text('callers'),                  // JSON array of caller symbol names
  tokensEstimate: integer('tokens_estimate').notNull().default(0),
  contentHash: text('content_hash').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ── Indexed Files (file-level cache for incremental indexing) ──

export const indexedFiles = sqliteTable('indexed_files', {
  projectPath: text('project_path').notNull(),
  file: text('file').notNull(),
  hash: text('hash').notNull(),
  indexedAt: integer('indexed_at').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectPath, t.file] }),
}));

// ── Briefs (strict task contracts for sub-agents) ──

export const briefs = sqliteTable('briefs', {
  id: text('id').primaryKey(),
  projectPath: text('project_path').notNull(),
  task: text('task').notNull(),
  constraints: text('constraints'),          // JSON array
  knownContext: text('known_context'),       // JSON: [{symbol,file,range}]
  allowedActions: text('allowed_actions'),   // JSON: [{type,file,range}]
  unknowns: text('unknowns'),                // JSON array
  successCriteria: text('success_criteria'), // JSON array
  status: text('status').notNull().default('active'), // active|frozen|done
  createdAt: integer('created_at').notNull(),
});

// ── Findings (shared memory pool across sub-agents) ──

export const findings = sqliteTable('findings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  agentRole: text('agent_role').notNull(),   // explorer|implementer|reviewer|orchestrator
  type: text('type').notNull(),              // bug|assumption|decision|deadend|pattern
  symbol: text('symbol'),
  file: text('file'),
  finding: text('finding').notNull(),
  confidence: real('confidence').notNull().default(0.8),
  createdAt: integer('created_at').notNull(),
});

// ── Agent Run Cache (semantic memoization) ──

export const agentCache = sqliteTable('agent_cache', {
  intentHash: text('intent_hash').primaryKey(),
  action: text('action').notNull(),
  inputs: text('inputs').notNull(),          // JSON
  result: text('result').notNull(),          // JSON
  hits: integer('hits').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

// ── Benchmark tables (v6) ──

export const benchTasks = sqliteTable('bench_tasks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  oracleJson: text('oracle_json'),
  createdAt: integer('created_at').notNull(),
});

export const benchRuns = sqliteTable('bench_runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => benchTasks.id, { onDelete: 'cascade' }),
  variant: text('variant').notNull(),          // 'ctk' | 'baseline'
  model: text('model').notNull(),
  sourceJsonl: text('source_jsonl'),
  sessionId: text('session_id'),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at').notNull(),
  wallMs: integer('wall_ms').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheRead: integer('cache_read').notNull().default(0),
  cacheCreation: integer('cache_creation').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  turnCount: integer('turn_count').notNull().default(0),
  stopReason: text('stop_reason'),
  toolCallsJson: text('tool_calls_json'),
  success: integer('success'),
  notes: text('notes'),
  checksum: text('checksum').notNull(),
  provenanceAuthor: text('provenance_author'),
  provenanceCommit: text('provenance_commit'),
  importedFrom: text('imported_from'),
  createdAt: integer('created_at').notNull(),
});

export const benchTurns = sqliteTable('bench_turns', {
  runId: text('run_id').notNull().references(() => benchRuns.id, { onDelete: 'cascade' }),
  turnIdx: integer('turn_idx').notNull(),
  role: text('role').notNull(),
  timestamp: integer('timestamp').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheRead: integer('cache_read').notNull().default(0),
  cacheCreation: integer('cache_creation').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  toolsJson: text('tools_json'),
  stopReason: text('stop_reason'),
}, (t) => ({
  pk: primaryKey({ columns: [t.runId, t.turnIdx] }),
}));

export const benchImports = sqliteTable('bench_imports', {
  id: text('id').primaryKey(),
  importedAt: integer('imported_at').notNull(),
  sourceFile: text('source_file').notNull(),
  author: text('author'),
  commitSha: text('commit_sha'),
  rowCount: integer('row_count').notNull().default(0),
  checksum: text('checksum').notNull(),
});
