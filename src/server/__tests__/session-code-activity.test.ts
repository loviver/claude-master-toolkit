import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import type { FastifyInstance } from 'fastify';
import { migrate } from '../../shared/db/migrate';
import { closeDb } from '../../shared/db/db';
import { buildApp } from '../index';
import type { SessionCodeActivityDTO } from '../../shared/api-types';

const SESSION_ID = 'sess-activity-1';
const PROJECT = '/tmp/ctk-activity-project';
const NOW = Date.now();

function seed(dbPath: string): [number, number] {
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO sessions (id, project_path, started_at, last_active_at, primary_model, turn_count,
       total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens,
       total_cost_usd, jsonl_file)
     VALUES (?, ?, ?, ?, 'claude-opus-4-1', 2, 0, 0, 0, 0, 0.3, '/tmp/ctk-activity.jsonl')`,
  ).run(SESSION_ID, PROJECT, NOW - 60_000, NOW);
  const insertEvent = db.prepare(
    `INSERT INTO token_events (session_id, timestamp, model, cost_usd, uuid)
     VALUES (?, ?, 'claude-opus-4-1', ?, ?)`,
  );
  const e1 = Number(insertEvent.run(SESSION_ID, NOW - 50_000, 0.1, 'u1').lastInsertRowid);
  const e2 = Number(insertEvent.run(SESSION_ID, NOW - 10_000, 0.2, 'u2').lastInsertRowid);
  const insertTool = db.prepare(
    `INSERT INTO turn_tool_calls (event_id, tool_use_id, tool_name, order_idx, input_json, result_is_error)
     VALUES (?, ?, ?, 0, ?, ?)`,
  );
  insertTool.run(e1, 't1', 'Read', JSON.stringify({ file_path: `${PROJECT}/src/a.ts` }), 0);
  insertTool.run(e1, 't2', 'Bash', JSON.stringify({ command: 'ls' }), 0);
  insertTool.run(e2, 't3', 'Edit', JSON.stringify({ file_path: `${PROJECT}/src/a.ts` }), 1);
  db.prepare(
    `INSERT INTO turn_file_changes (session_id, event_id, message_id, file_path) VALUES (?, ?, 'm2', ?)`,
  ).run(SESSION_ID, e2, '/home/elsewhere/plan.md');
  db.prepare(
    `INSERT INTO turn_file_changes (session_id, event_id, message_id, file_path) VALUES (?, ?, 'm2', 'src/b.ts')`,
  ).run(SESSION_ID, e2);
  db.close();
  return [e1, e2];
}

describe('GET /api/sessions/:id/code-activity', () => {
  let dir: string;
  let app: FastifyInstance;
  let e1: number;
  let e2: number;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ctk-activity-'));
    const dbPath = join(dir, 'ctk.sqlite');
    process.env.CTK_DB_PATH = dbPath;
    closeDb();
    migrate();
    [e1, e2] = seed(dbPath);
    app = await buildApp({ serveStatic: false });
  });

  afterAll(async () => {
    await app?.close();
    closeDb();
    delete process.env.CTK_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists the project files the session touched, per turn', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${SESSION_ID}/code-activity` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SessionCodeActivityDTO;
    expect(body).toMatchObject({ sessionId: SESSION_ID, projectPath: PROJECT, indexed: false });
    expect(body.files.map((f) => f.file)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(body.files[0]).toMatchObject({ reads: 1, edits: 1 });
    expect(body.files[0].turns).toEqual([
      { eventId: e1, timestamp: NOW - 50_000, costUsd: 0.1, toolErrors: 0, ops: ['read'] },
      { eventId: e2, timestamp: NOW - 10_000, costUsd: 0.2, toolErrors: 1, ops: ['edit'] },
    ]);
  });

  it('returns 404 for an unknown session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions/nope/code-activity' });
    expect(res.statusCode).toBe(404);
  });
});
