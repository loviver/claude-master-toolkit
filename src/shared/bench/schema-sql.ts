export const BENCH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS bench_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  oracle_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bench_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES bench_tasks(id) ON DELETE CASCADE,
  variant TEXT NOT NULL CHECK (variant IN ('ctk','baseline')),
  model TEXT NOT NULL,
  source_jsonl TEXT,
  session_id TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  wall_ms INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_creation INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT,
  tool_calls_json TEXT,
  success INTEGER,
  notes TEXT,
  checksum TEXT NOT NULL,
  provenance_author TEXT,
  provenance_commit TEXT,
  imported_from TEXT,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bench_runs_unique
  ON bench_runs(task_id, variant, checksum);
CREATE INDEX IF NOT EXISTS idx_bench_runs_task ON bench_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_bench_runs_variant ON bench_runs(variant);

CREATE TABLE IF NOT EXISTS bench_turns (
  run_id TEXT NOT NULL REFERENCES bench_runs(id) ON DELETE CASCADE,
  turn_idx INTEGER NOT NULL,
  role TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_creation INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  tools_json TEXT,
  stop_reason TEXT,
  PRIMARY KEY (run_id, turn_idx)
);

CREATE INDEX IF NOT EXISTS idx_bench_turns_run ON bench_turns(run_id);

CREATE TABLE IF NOT EXISTS bench_imports (
  id TEXT PRIMARY KEY,
  imported_at INTEGER NOT NULL,
  source_file TEXT NOT NULL,
  author TEXT,
  commit_sha TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bench_imports_checksum ON bench_imports(checksum);
`;
