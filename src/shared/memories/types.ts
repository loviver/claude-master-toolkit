// ── Memory type enumerations ──

export type MemoryType =
  | 'decision'
  | 'bugfix'
  | 'architecture'
  | 'pattern'
  | 'preference'
  | 'reference'
  | 'note'
  | 'session_summary';

export type MemoryScope = 'project' | 'personal';

// ── Database row shape ──

export interface MemoryRow {
  id: string;
  session_id: string | null;
  title: string;
  type: MemoryType | null;
  what: string | null;
  why: string | null;
  where_: string | null;
  learned: string | null;
  topic_key: string | null;
  model: string | null;
  phase: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cache_hit_pct: number | null;
  cost_usd: number | null;
  access_count: number;
  cost_saved_usd: number;
  created_at: number;
  updated_at: number | null;
  accessed_at: number | null;
  scope: MemoryScope;
  project_path: string | null;
  description: string | null;
  file_path: string | null;
}

// ── CRUD input shapes ──

export interface SaveInput {
  title: string;
  type?: MemoryType;
  what?: string;
  why?: string;
  where?: string;
  learned?: string;
  topicKey?: string;
  scope?: MemoryScope;
  projectPath?: string;
  sessionId?: string;
  model?: string;
  phase?: string;
  tokensInput?: number;
  tokensOutput?: number;
  cacheHitPct?: number;
  costUsd?: number;
  description?: string;
  filePath?: string;
}

export interface UpdateInput {
  title?: string;
  type?: MemoryType;
  what?: string;
  why?: string;
  where?: string;
  learned?: string;
  topicKey?: string;
  scope?: MemoryScope;
  projectPath?: string;
  description?: string;
  filePath?: string;
  model?: string;
  phase?: string;
  tokensInput?: number;
  tokensOutput?: number;
  cacheHitPct?: number;
  costUsd?: number;
}

// ── Search input/output shapes ──

export interface RecallInput {
  query: string;
  limit?: number;
  type?: MemoryType;
  scope?: MemoryScope;
  projectPath?: string;
  sessionId?: string;
}

export interface RecallRow extends MemoryRow {
  rank: number;
}

export interface ContextInput {
  projectPath?: string;
  sessionId?: string;
  limit?: number;
}

export interface TraceInput {
  limit?: number;
  projectPath?: string;
  sessionId?: string;
}

export interface SuggestInput {
  title: string;
  content?: string;
  type?: MemoryType;
  limit?: number;
}

export interface SuggestHint {
  topicKey: string;
  score: number;
}

// ── Session helper inputs ──

export interface SessionStartInput {
  sessionId: string;
  projectPath?: string;
  directory?: string;
}

export interface SessionEndInput {
  sessionId: string;
  summary?: string;
  projectPath?: string;
}

export interface SessionSummaryInput {
  sessionId: string;
  content: string;
  title?: string;
  projectPath?: string;
}

export interface PassiveInput {
  content: string;
  sessionId?: string;
  projectPath?: string;
  source?: string;
  title?: string;
}

export interface MergeInput {
  from: string;
  to: string;
}

// ── Stats shapes ──

export interface StatsInput {
  projectPath?: string;
}

export interface StatsOut {
  memoriesTotal: number;
  memoriesByType: Record<string, number>;
  recallQueries: number;
  totalCostSaved: number;
  topAccessed: Array<{ id: string; title: string; accessCount: number; costSavedUsd: number }>;
}

// ── Export/import shapes ──

export interface VaultDump {
  version: number;
  memories: MemoryRow[];
  searches: Array<{
    id: string;
    session_id: string | null;
    memory_id: string | null;
    query: string;
    rank: number | null;
    created_at: number;
  }>;
}
