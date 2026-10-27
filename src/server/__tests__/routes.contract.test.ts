/**
 * Characterization tests for the dashboard API.
 *
 * Pins the response SHAPE (keys + value types) of every endpoint the client
 * keeps consuming, so moving SQL out of the routes (strangler refactor) can
 * be checked against an unchanged contract.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import type { FastifyInstance } from 'fastify';
import { migrate } from '../../shared/db/migrate';
import { closeDb } from '../../shared/db/db';
import { buildApp } from '../index';

const SESSION_ID = 'sess-contract-1';
const NOW = Date.now();

function seed(dbPath: string): number {
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO sessions (id, project_path, started_at, last_active_at, primary_model, git_branch,
       turn_count, total_input_tokens, total_output_tokens, total_cache_read_tokens,
       total_cache_creation_tokens, total_cost_usd, jsonl_file, custom_title)
     VALUES (?, '/tmp/ctk-contract-project', ?, ?, 'claude-opus-4-1', 'main',
       2, 300, 120, 1000, 200, 0.42, '/tmp/ctk-contract.jsonl', 'contract session')`,
  ).run(SESSION_ID, NOW - 60_000, NOW);

  const insertEvent = db.prepare(
    `INSERT INTO token_events (session_id, timestamp, model, input_tokens, output_tokens,
       cache_read_tokens, cache_creation_tokens, cost_usd, tools_used, stop_reason,
       semantic_phase, uuid)
     VALUES (?, ?, 'claude-opus-4-1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const first = insertEvent.run(
    SESSION_ID, NOW - 50_000, 100, 40, 500, 200, 0.2, '["Read","Grep"]', 'tool_use', 'exploration', 'uuid-1',
  );
  insertEvent.run(
    SESSION_ID, NOW - 10_000, 200, 80, 500, 0, 0.22, '["Edit"]', 'end_turn', 'implementation', 'uuid-2',
  );

  const eventId = Number(first.lastInsertRowid);
  const assistantContent = JSON.stringify([
    { type: 'text', text: 'Reading the file.' },
    { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/a.ts' } },
  ]);
  db.prepare(
    `INSERT INTO turn_content (event_id, role, content, content_hash, byte_size)
     VALUES (?, 'assistant', ?, 'hash-1', ?)`,
  ).run(eventId, assistantContent, assistantContent.length);
  db.prepare(
    `INSERT INTO turn_tool_calls (event_id, tool_use_id, tool_name, order_idx, input_json, result_content)
     VALUES (?, 'toolu_1', 'Read', 0, '{"file_path":"/tmp/a.ts"}', 'file body')`,
  ).run(eventId);

  db.prepare(
    `INSERT INTO memories_v2 (id, title, type, what, topic_key, created_at, scope, project_path)
     VALUES ('mem-contract-1', 'Decided contract tests', 'decision', 'pin api shape',
       'testing/contract', ?, 'project', '/tmp/ctk-contract-project')`,
  ).run(NOW);

  db.close();
  return eventId;
}

/** Recursive type skeleton: values vary between runs, structure must not. */
function shape(value: unknown): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length ? [shape(value[0])] : [];
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, shape((value as Record<string, unknown>)[k])]),
    );
  }
  return typeof value;
}

describe('dashboard API contract', () => {
  let dir: string;
  let app: FastifyInstance;
  let eventId: number;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ctk-contract-'));
    const dbPath = join(dir, 'ctk.sqlite');
    process.env.CTK_DB_PATH = dbPath;
    closeDb();
    migrate();
    eventId = seed(dbPath);
    app = await buildApp({ serveStatic: false });
  });

  afterAll(async () => {
    await app?.close();
    closeDb();
    delete process.env.CTK_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  const endpoints = [
    '/api/health',
    '/api/sessions',
    `/api/sessions/${SESSION_ID}`,
    `/api/sessions/${SESSION_ID}/graph`,
    '/api/stats/current',
    '/api/stats/timeline',
    '/api/stats/models',
    '/api/stats/efficiency',
    '/api/stats/phases',
    '/api/stats/tools',
    '/api/stats/score',
    '/api/stats/projects',
    '/api/stats/activity',
    '/api/stats/dashboard',
    '/api/memories',
    '/api/memories/mem-contract-1',
    '/api/memories/stats/roi',
    '/api/memories/stats/cost-per-session',
    '/api/memories/stats/anomalies',
    '/api/settings',
  ];

  it.each(endpoints)('GET %s keeps its response shape', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(shape(res.json())).toMatchSnapshot();
  });

  it('GET /api/sessions/:id/turns/:eventId/content keeps its response shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${SESSION_ID}/turns/${eventId}/content`,
    });
    expect(res.statusCode).toBe(200);
    expect(shape(res.json())).toMatchSnapshot();
  });

  it('GET /api/sessions/:id returns 404 for an unknown session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });
});
