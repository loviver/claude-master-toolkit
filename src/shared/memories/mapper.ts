/**
 * Memory row ↔ API translation layer.
 *
 * DB layer uses snake_case (SQL idiomatic + reserved-word escaping: `where` → `where_`).
 * API / CLI layer uses camelCase (JS idiomatic).
 *
 * This module is the ONLY place that should hand-translate between the two.
 * All crud.ts / search.ts / REST route code must call into these helpers
 * instead of listing field mappings inline.
 *
 * Binding arrays are returned in the exact positional order required by the
 * corresponding prepared SQL statement in crud.ts. Reordering in SQL requires
 * reordering here in lockstep.
 */

import type { MemoryRow, MemoryScope, MemoryType, SaveInput, UpdateInput } from './types.js';

// ── API → DB (positional bindings for prepared statements) ──

/**
 * Bindings for INSERT into memories_v2.
 * Column order:
 *   id, session_id, title, type, what, why, where_, learned, topic_key,
 *   model, phase, tokens_input, tokens_output, cache_hit_pct, cost_usd,
 *   scope, project_path, description, file_path,
 *   created_at, updated_at
 */
export function toInsertBindings(input: SaveInput, id: string, now: number): unknown[] {
  const type: MemoryType = input.type ?? 'note';
  const scope: MemoryScope = input.scope ?? 'project';
  return [
    id,
    input.sessionId ?? null,
    input.title,
    type,
    input.what ?? null,
    input.why ?? null,
    input.where ?? null,
    input.learned ?? null,
    input.topicKey ?? null,
    input.model ?? null,
    input.phase ?? null,
    input.tokensInput ?? null,
    input.tokensOutput ?? null,
    input.cacheHitPct ?? null,
    input.costUsd ?? null,
    scope,
    input.projectPath ?? null,
    input.description ?? null,
    input.filePath ?? null,
    now,
    now,
  ];
}

/**
 * Bindings for UPSERT by topic_key (partial merge with existing row).
 * Column order (SET clause + WHERE):
 *   title, type, what, why, where_, learned,
 *   project_path, session_id,
 *   model, phase, tokens_input, tokens_output, cache_hit_pct, cost_usd,
 *   description, file_path,
 *   updated_at, id
 */
export function toUpsertBindings(input: SaveInput, existing: MemoryRow, now: number): unknown[] {
  const type: MemoryType = input.type ?? existing.type ?? 'note';
  return [
    input.title,
    type,
    input.what ?? existing.what,
    input.why ?? existing.why,
    input.where ?? existing.where_,
    input.learned ?? existing.learned,
    input.projectPath ?? existing.project_path,
    input.sessionId ?? existing.session_id,
    input.model ?? existing.model,
    input.phase ?? existing.phase,
    input.tokensInput ?? existing.tokens_input,
    input.tokensOutput ?? existing.tokens_output,
    input.cacheHitPct ?? existing.cache_hit_pct,
    input.costUsd ?? existing.cost_usd,
    input.description ?? existing.description,
    input.filePath ?? existing.file_path,
    now,
    existing.id,
  ];
}

/**
 * Bindings for explicit UPDATE by id (from update()).
 * Column order (SET clause + WHERE):
 *   title, type, what, why, where_, learned, topic_key,
 *   scope, project_path, description, file_path,
 *   model, phase, tokens_input, tokens_output, cache_hit_pct, cost_usd,
 *   updated_at, id
 */
export function toUpdateBindings(
  input: UpdateInput,
  existing: MemoryRow,
  now: number,
  id: string,
): unknown[] {
  return [
    input.title ?? existing.title,
    input.type ?? existing.type,
    input.what ?? existing.what,
    input.why ?? existing.why,
    input.where ?? existing.where_,
    input.learned ?? existing.learned,
    input.topicKey ?? existing.topic_key,
    input.scope ?? existing.scope,
    input.projectPath ?? existing.project_path,
    input.description ?? existing.description,
    input.filePath ?? existing.file_path,
    input.model ?? existing.model,
    input.phase ?? existing.phase,
    input.tokensInput ?? existing.tokens_input,
    input.tokensOutput ?? existing.tokens_output,
    input.cacheHitPct ?? existing.cache_hit_pct,
    input.costUsd ?? existing.cost_usd,
    now,
    id,
  ];
}

// ── DB → API (shape for REST responses / CLI JSON output) ──

export interface MemoryDto {
  id: string;
  sessionId: string | null;
  title: string;
  type: MemoryType | null;
  what: string | null;
  why: string | null;
  where: string | null;
  learned: string | null;
  topicKey: string | null;
  projectPath: string | null;
  scope: MemoryScope;
  model: string | null;
  phase: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  cacheHitPct: number | null;
  costUsd: number | null;
  accessCount: number;
  costSavedUsd: number;
  createdAt: number;
  updatedAt: number | null;
  accessedAt: number | null;
  description: string | null;
  filePath: string | null;
}

export function fromDbRow(row: MemoryRow): MemoryDto {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    type: row.type,
    what: row.what,
    why: row.why,
    where: row.where_,
    learned: row.learned,
    topicKey: row.topic_key,
    projectPath: row.project_path,
    scope: row.scope,
    model: row.model,
    phase: row.phase,
    tokensInput: row.tokens_input,
    tokensOutput: row.tokens_output,
    cacheHitPct: row.cache_hit_pct,
    costUsd: row.cost_usd,
    accessCount: row.access_count,
    costSavedUsd: row.cost_saved_usd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    accessedAt: row.accessed_at,
    description: row.description,
    filePath: row.file_path,
  };
}
