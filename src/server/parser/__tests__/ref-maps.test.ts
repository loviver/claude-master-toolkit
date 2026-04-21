import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { tokenEvents, sessions } from '../../../shared/db/schema.js';
import { loadRefMaps } from '../builders/ref-maps.js';

function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_path TEXT NOT NULL, started_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL, primary_model TEXT NOT NULL DEFAULT 'unknown',
      git_branch TEXT, version TEXT, turn_count INTEGER NOT NULL DEFAULT 0,
      total_input_tokens INTEGER NOT NULL DEFAULT 0, total_output_tokens INTEGER NOT NULL DEFAULT 0,
      total_cache_read_tokens INTEGER NOT NULL DEFAULT 0, total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_cost_usd REAL NOT NULL DEFAULT 0, jsonl_file TEXT NOT NULL,
      custom_title TEXT, last_prompt TEXT, entrypoint TEXT
    );
    CREATE TABLE token_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
      model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0, uuid TEXT, message_id TEXT,
      tools_used TEXT, stop_reason TEXT, is_sidechain INTEGER DEFAULT 0,
      parent_uuid TEXT, semantic_phase TEXT, agent_role TEXT, request_id TEXT,
      slug TEXT, api_error_status TEXT, is_api_error INTEGER DEFAULT 0,
      service_tier TEXT, speed TEXT, cache_1h_tokens INTEGER DEFAULT 0,
      cache_5m_tokens INTEGER DEFAULT 0, web_search_count INTEGER DEFAULT 0,
      web_fetch_count INTEGER DEFAULT 0, iterations_count INTEGER DEFAULT 0,
      duration_ms INTEGER, permission_mode TEXT, has_thinking INTEGER DEFAULT 0,
      thinking_text TEXT, thinking_signature TEXT, prompt_id TEXT, cwd TEXT,
      git_branch TEXT, is_meta INTEGER DEFAULT 0, is_compact_summary INTEGER DEFAULT 0,
      user_type TEXT, event_subtype TEXT, event_level TEXT
    );
  `);
  return drizzle(sqlite);
}

describe('loadRefMaps', () => {
  it('returns empty maps for unknown session', () => {
    const db = makeDb();
    const result = loadRefMaps(db, 'nonexistent');
    expect(result.priorUuids.size).toBe(0);
    expect(result.uuidToEventId.size).toBe(0);
    expect(result.messageIdToEventId.size).toBe(0);
    expect(result.newEventIds.size).toBe(0);
  });

  it('returns empty maps for session with no token_events', () => {
    const db = makeDb();
    db.insert(sessions).values({
      id: 'sess1', projectPath: '/p', startedAt: 1, lastActiveAt: 1,
      primaryModel: 'm', jsonlFile: '/f',
    }).run();
    const result = loadRefMaps(db, 'sess1');
    expect(result.priorUuids.size).toBe(0);
  });

  it('populates maps from existing token_events', () => {
    const db = makeDb();
    db.insert(sessions).values({
      id: 'sess1', projectPath: '/p', startedAt: 1, lastActiveAt: 1,
      primaryModel: 'm', jsonlFile: '/f',
    }).run();
    db.insert(tokenEvents).values({
      sessionId: 'sess1', timestamp: 1, model: 'm',
      uuid: 'uuid-abc', messageId: 'msg-xyz',
    }).run();
    const result = loadRefMaps(db, 'sess1');
    expect(result.priorUuids.has('uuid-abc')).toBe(true);
    expect(result.uuidToEventId.has('uuid-abc')).toBe(true);
    expect(result.messageIdToEventId.has('msg-xyz')).toBe(true);
    expect(result.newEventIds.size).toBe(0);
  });
});
