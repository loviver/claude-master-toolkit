import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';
import { BENCH_SCHEMA_SQL } from '../../shared/bench/schema-sql.js';

const DEFAULT_DB_DIR = join(homedir(), '.claude', 'state', 'claude-master-toolkit');
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, 'ctk.sqlite');

function resolveDbPath(): string {
  return process.env['CTK_DB_PATH'] ?? DEFAULT_DB_PATH;
}

/**
 * Run migrations using raw SQL (no drizzle-kit needed at runtime).
 * Idempotent: uses IF NOT EXISTS.
 */
export function migrate(): void {
  const dbPath = resolveDbPath();
  mkdirSync(join(dbPath, '..'), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      primary_model TEXT NOT NULL DEFAULT 'unknown',
      git_branch TEXT,
      version TEXT,
      turn_count INTEGER NOT NULL DEFAULT 0,
      total_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0,
      total_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_cost_usd REAL NOT NULL DEFAULT 0,
      jsonl_file TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS token_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      timestamp INTEGER NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      file_path TEXT PRIMARY KEY,
      last_byte_offset INTEGER NOT NULL DEFAULT 0,
      last_modified INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_token_events_session ON token_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_token_events_timestamp ON token_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
  `);

  // v2: Enriched token_events columns + turn_content table
  const addColumnSafe = (table: string, col: string, type: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
  };

  addColumnSafe('token_events', 'tools_used', 'TEXT');
  addColumnSafe('token_events', 'stop_reason', 'TEXT');
  addColumnSafe('token_events', 'is_sidechain', 'INTEGER DEFAULT 0');
  addColumnSafe('token_events', 'parent_uuid', 'TEXT');
  addColumnSafe('token_events', 'semantic_phase', 'TEXT');
  addColumnSafe('token_events', 'agent_role', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS turn_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES token_events(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      byte_size INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_turn_content_event ON turn_content(event_id);
    CREATE INDEX IF NOT EXISTS idx_turn_content_hash ON turn_content(content_hash);
    CREATE INDEX IF NOT EXISTS idx_token_events_phase ON token_events(semantic_phase);
    CREATE INDEX IF NOT EXISTS idx_token_events_sidechain ON token_events(is_sidechain);
  `);

  // v4: Semantic symbol index + briefs + findings + agent cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      file TEXT NOT NULL,
      symbol TEXT NOT NULL,
      kind TEXT NOT NULL,
      signature TEXT,
      summary TEXT,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      exported INTEGER NOT NULL DEFAULT 0,
      deps TEXT,
      callers TEXT,
      tokens_estimate INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_symbols_project ON symbols(project_path);
    CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file);
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(symbol);
    CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_symbols_unique ON symbols(project_path, file, symbol, start_line);

    CREATE TABLE IF NOT EXISTS briefs (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      task TEXT NOT NULL,
      constraints TEXT,
      known_context TEXT,
      allowed_actions TEXT,
      unknowns TEXT,
      success_criteria TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_briefs_project ON briefs(project_path);
    CREATE INDEX IF NOT EXISTS idx_briefs_status ON briefs(status);

    CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      agent_role TEXT NOT NULL,
      type TEXT NOT NULL,
      symbol TEXT,
      file TEXT,
      finding TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.8,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_findings_session ON findings(session_id);
    CREATE INDEX IF NOT EXISTS idx_findings_symbol ON findings(symbol);
    CREATE INDEX IF NOT EXISTS idx_findings_type ON findings(type);

    CREATE TABLE IF NOT EXISTS agent_cache (
      intent_hash TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      inputs TEXT NOT NULL,
      result TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_cache_action ON agent_cache(action);
    CREATE INDEX IF NOT EXISTS idx_agent_cache_expires ON agent_cache(expires_at);
  `);

  // v5: File-level cache for incremental indexing
  db.exec(`
    CREATE TABLE IF NOT EXISTS indexed_files (
      project_path TEXT NOT NULL,
      file TEXT NOT NULL,
      hash TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      PRIMARY KEY (project_path, file)
    );

    CREATE INDEX IF NOT EXISTS idx_indexed_files_project ON indexed_files(project_path);
  `);

  // v6: Benchmarks — ctk A/B data with export/import provenance
  db.exec(BENCH_SCHEMA_SQL);

  // v7: Turn-graph enrichment — extra token_events columns + hooks/file-changes tables
  addColumnSafe('token_events', 'uuid', 'TEXT');
  addColumnSafe('token_events', 'message_id', 'TEXT');
  addColumnSafe('token_events', 'request_id', 'TEXT');
  addColumnSafe('token_events', 'slug', 'TEXT');
  addColumnSafe('token_events', 'api_error_status', 'TEXT');
  addColumnSafe('token_events', 'is_api_error', 'INTEGER DEFAULT 0');
  addColumnSafe('token_events', 'service_tier', 'TEXT');
  addColumnSafe('token_events', 'speed', 'TEXT');
  addColumnSafe('token_events', 'cache_1h_tokens', 'INTEGER DEFAULT 0');
  addColumnSafe('token_events', 'cache_5m_tokens', 'INTEGER DEFAULT 0');
  addColumnSafe('token_events', 'web_search_count', 'INTEGER DEFAULT 0');
  addColumnSafe('token_events', 'web_fetch_count', 'INTEGER DEFAULT 0');
  addColumnSafe('token_events', 'iterations_count', 'INTEGER DEFAULT 0');
  addColumnSafe('token_events', 'duration_ms', 'INTEGER');
  addColumnSafe('token_events', 'permission_mode', 'TEXT');
  addColumnSafe('token_events', 'has_thinking', 'INTEGER DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS turn_hooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_id INTEGER,
      hook_name TEXT NOT NULL,
      hook_event TEXT NOT NULL,
      exit_code INTEGER,
      duration_ms INTEGER,
      stdout TEXT,
      stderr TEXT,
      command TEXT,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_turn_hooks_session ON turn_hooks(session_id);
    CREATE INDEX IF NOT EXISTS idx_turn_hooks_event ON turn_hooks(event_id);

    CREATE TABLE IF NOT EXISTS turn_file_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_id INTEGER,
      message_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      is_snapshot_update INTEGER DEFAULT 0,
      timestamp INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_turn_file_changes_session ON turn_file_changes(session_id);
    CREATE INDEX IF NOT EXISTS idx_turn_file_changes_event ON turn_file_changes(event_id);
    CREATE INDEX IF NOT EXISTS idx_turn_file_changes_message ON turn_file_changes(message_id);

    CREATE INDEX IF NOT EXISTS idx_token_events_uuid ON token_events(uuid);
    CREATE INDEX IF NOT EXISTS idx_token_events_message_id ON token_events(message_id);
    CREATE INDEX IF NOT EXISTS idx_token_events_session_timestamp ON token_events(session_id, timestamp);
  `);

  // v9: Enriched drawer fields + structured tool_calls table
  addColumnSafe('token_events', 'thinking_text', 'TEXT');
  addColumnSafe('token_events', 'thinking_signature', 'TEXT');
  addColumnSafe('token_events', 'prompt_id', 'TEXT');
  addColumnSafe('token_events', 'cwd', 'TEXT');
  addColumnSafe('token_events', 'git_branch', 'TEXT');
  addColumnSafe('token_events', 'is_meta', 'INTEGER DEFAULT 0');
  addColumnSafe('token_events', 'is_compact_summary', 'INTEGER DEFAULT 0');
  addColumnSafe('token_events', 'user_type', 'TEXT');

  // v10: session-level JSONL extras
  addColumnSafe('sessions', 'custom_title', 'TEXT');
  addColumnSafe('sessions', 'last_prompt', 'TEXT');
  addColumnSafe('sessions', 'entrypoint', 'TEXT');

  // v10: event-level JSONL extras (per turn)
  addColumnSafe('token_events', 'event_subtype', 'TEXT');
  addColumnSafe('token_events', 'event_level', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS turn_tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES token_events(id) ON DELETE CASCADE,
      tool_use_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      order_idx INTEGER NOT NULL DEFAULT 0,
      input_json TEXT,
      result_is_error INTEGER,
      result_content TEXT,
      result_stderr TEXT,
      result_stdout TEXT,
      result_exit_code INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_turn_tool_calls_event ON turn_tool_calls(event_id);
    CREATE INDEX IF NOT EXISTS idx_turn_tool_calls_use_id ON turn_tool_calls(tool_use_id);
    CREATE INDEX IF NOT EXISTS idx_turn_tool_calls_name ON turn_tool_calls(tool_name);
  `);

  // v10: Settings (generic key/value)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // v8: Pandorica v2 — unified memories_v2 + FTS5 + memory_searches
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories_v2 (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      title TEXT NOT NULL,
      type TEXT,
      what TEXT,
      why TEXT,
      where_ TEXT,
      learned TEXT,
      topic_key TEXT,
      model TEXT,
      phase TEXT,
      tokens_input INTEGER,
      tokens_output INTEGER,
      cache_hit_pct REAL,
      cost_usd REAL,
      access_count INTEGER NOT NULL DEFAULT 0,
      cost_saved_usd REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      accessed_at INTEGER,
      scope TEXT NOT NULL DEFAULT 'project',
      project_path TEXT,
      description TEXT,
      file_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_memories_v2_session ON memories_v2(session_id);
    CREATE INDEX IF NOT EXISTS idx_memories_v2_topic ON memories_v2(topic_key);
    CREATE INDEX IF NOT EXISTS idx_memories_v2_type ON memories_v2(type);
    CREATE INDEX IF NOT EXISTS idx_memories_v2_created ON memories_v2(created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_v2_project ON memories_v2(project_path);

    CREATE TABLE IF NOT EXISTS memory_searches (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      memory_id TEXT,
      query TEXT NOT NULL,
      rank REAL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memory_searches_session ON memory_searches(session_id);
    CREATE INDEX IF NOT EXISTS idx_memory_searches_memory ON memory_searches(memory_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      title, what, why, where_, learned,
      content='memories_v2',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS memories_v2_ai AFTER INSERT ON memories_v2 BEGIN
      INSERT INTO memories_fts(rowid, title, what, why, where_, learned)
      VALUES (new.rowid, new.title, new.what, new.why, new.where_, new.learned);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_v2_ad AFTER DELETE ON memories_v2 BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, what, why, where_, learned)
      VALUES ('delete', old.rowid, old.title, old.what, old.why, old.where_, old.learned);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_v2_au AFTER UPDATE ON memories_v2 BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, title, what, why, where_, learned)
      VALUES ('delete', old.rowid, old.title, old.what, old.why, old.where_, old.learned);
      INSERT INTO memories_fts(rowid, title, what, why, where_, learned)
      VALUES (new.rowid, new.title, new.what, new.why, new.where_, new.learned);
    END;
  `);

  // v9 plans (workflow execution)
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      definition TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      project_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_path);

    CREATE TABLE IF NOT EXISTS plan_executions (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'pending',
      current_node_id TEXT,
      output TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      timeline TEXT,
      mutation_log TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_plan_executions_plan ON plan_executions(plan_id);
    CREATE INDEX IF NOT EXISTS idx_plan_executions_state ON plan_executions(state);

    CREATE TABLE IF NOT EXISTS plan_node_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id TEXT NOT NULL REFERENCES plan_executions(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      output TEXT,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_plan_node_states_execution ON plan_node_states(execution_id);
    CREATE INDEX IF NOT EXISTS idx_plan_node_states_node ON plan_node_states(node_id);
  `);

  // v10 plan_executions.mutation_log — agent-driven graph edits during execution
  const planExecCols = db.prepare(`PRAGMA table_info(plan_executions)`).all() as { name: string }[];
  if (!planExecCols.some((c) => c.name === 'mutation_log')) {
    db.exec(`ALTER TABLE plan_executions ADD COLUMN mutation_log TEXT`);
  }

  // v8 backfill: copy legacy memories → memories_v2 (idempotent via INSERT OR IGNORE on id)
  const legacyTables = ['memories', 'pandorica_memories'] as const;
  for (const t of legacyTables) {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(t);
    if (!exists) continue;
    const cols = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
    const has = (c: string) => cols.some((x) => x.name === c);
    const pick = (c: string, fallback = 'NULL') => (has(c) ? c : fallback);
    const titleExpr = has('title') ? 'title' : has('topic_key') ? 'topic_key' : `'(untitled)'`;
    const whatExpr = has('content') ? 'content' : has('what') ? 'what' : has('description') ? 'description' : 'NULL';
    const createdExpr = has('created_at') ? 'created_at' : `${Date.now()}`;
    db.exec(`
      INSERT OR IGNORE INTO memories_v2
        (id, session_id, title, type, what, topic_key, description,
         project_path, file_path, scope, access_count, cost_saved_usd,
         created_at, updated_at, accessed_at)
      SELECT
        ${pick('id', "lower(hex(randomblob(16)))")},
        ${pick('session_id')},
        ${titleExpr},
        ${pick('type')},
        ${whatExpr},
        ${pick('topic_key')},
        ${pick('description')},
        ${pick('project_path')},
        ${pick('file_path')},
        COALESCE(${pick('scope', "'project'")}, 'project'),
        COALESCE(${pick('access_count', '0')}, 0),
        0,
        ${createdExpr},
        ${pick('updated_at')},
        ${pick('last_accessed_at', pick('accessed_at'))}
      FROM ${t};
      DROP TABLE ${t};
    `);
  }

  db.close();
}

// Run directly: tsx src/server/db/migrate.ts
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  migrate();
  console.log('Migration complete.');
}
