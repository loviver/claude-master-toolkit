import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { syncFile, syncSession } from '../parser/sync.js';
import { getDb } from '../db/db.js';
import { sessions, tokenEvents, turnContent, turnHooks, turnFileChanges, turnToolCalls } from '../db/schema.js';
import { resolveModelKey } from '../../shared/pricing.js';
import { sessionBus, type SessionBusEvent } from '../events/bus.js';
import type {
  SessionGraphDTO,
  SessionGraphNodeDTO,
  TurnContentDTO,
  TurnPairDTO,
  TurnToolCall,
  ThinkingBlockDTO,
  TurnHookDTO,
  ToolCallStructuredDTO,
} from '../../shared/api-types.js';

interface ListQuery {
  range?: string;
  project?: string;
  model?: string;
  limit?: string;
  offset?: string;
  q?: string;
}

function rangeToCutoff(range?: string): number | null {
  switch (range) {
    case '1d':  return Date.now() - 86_400_000;
    case '7d':  return Date.now() - 7 * 86_400_000;
    case '30d': return Date.now() - 30 * 86_400_000;
    case '90d': return Date.now() - 90 * 86_400_000;
    default:    return null;
  }
}

export async function sessionsRoutes(app: FastifyInstance): Promise<void> {
  // ── List sessions (enriched) ──
  app.get<{ Querystring: ListQuery }>('/sessions', async (req, reply) => {
    const db = getDb();
    const cutoff = rangeToCutoff(req.query.range);
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 500);
    const offset = parseInt(req.query.offset ?? '0', 10) || 0;

    const sessionRows = db.all<any>(sql`
      SELECT id, project_path, started_at, last_active_at, primary_model, git_branch,
             turn_count, total_input_tokens, total_output_tokens,
             total_cache_read_tokens, total_cache_creation_tokens, total_cost_usd
      FROM sessions
      WHERE ${cutoff ? sql`last_active_at >= ${cutoff}` : sql`1=1`}
        AND ${req.query.project ? sql`project_path = ${req.query.project}` : sql`1=1`}
        AND ${req.query.q ? sql`(project_path LIKE ${'%' + req.query.q + '%'} OR id LIKE ${'%' + req.query.q + '%'})` : sql`1=1`}
      ORDER BY last_active_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    if (sessionRows.length === 0) {
      return reply.send([]);
    }

    const ids = sessionRows.map((r) => r.id);

    // Models per session
    const modelRows = db.all<{ session_id: string; model: string; turns: number; cost_usd: number }>(sql`
      SELECT session_id, model, COUNT(*) AS turns, SUM(cost_usd) AS cost_usd
      FROM token_events
      WHERE session_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      GROUP BY session_id, model
    `);

    // Sidechain counts
    const sidechainRows = db.all<{ session_id: string; count: number }>(sql`
      SELECT session_id, COUNT(*) AS count
      FROM token_events
      WHERE is_sidechain = 1
        AND session_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      GROUP BY session_id
    `);

    // Tool counts (distinct tools used per session)
    const toolRows = db.all<{ session_id: string; tool_count: number }>(sql`
      SELECT session_id, COUNT(DISTINCT json_each.value) AS tool_count
      FROM token_events, json_each(tools_used)
      WHERE tools_used IS NOT NULL
        AND session_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      GROUP BY session_id
    `);

    // Dominant phase per session
    const phaseRows = db.all<{ session_id: string; phase: string; turns: number }>(sql`
      SELECT session_id, semantic_phase AS phase, COUNT(*) AS turns
      FROM token_events
      WHERE semantic_phase IS NOT NULL
        AND session_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      GROUP BY session_id, semantic_phase
    `);

    // v9 enrichment — thinking / api errors / tool errors per session
    const enrichRows = db.all<{ session_id: string; thinking_turns: number; api_errors: number; started_at: number; ended_at: number }>(sql`
      SELECT session_id,
             SUM(CASE WHEN has_thinking = 1 THEN 1 ELSE 0 END) AS thinking_turns,
             SUM(CASE WHEN is_api_error = 1 THEN 1 ELSE 0 END) AS api_errors,
             MIN(timestamp) AS started_at,
             MAX(timestamp) AS ended_at
      FROM token_events
      WHERE session_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      GROUP BY session_id
    `);

    const toolErrRows = db.all<{ session_id: string; n: number }>(sql`
      SELECT te.session_id AS session_id, COUNT(*) AS n
      FROM turn_tool_calls tt
      JOIN token_events te ON te.id = tt.event_id
      WHERE tt.result_is_error = 1
        AND te.session_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      GROUP BY te.session_id
    `);

    const modelsBySession = new Map<string, Array<{ model: string; modelKey: string; turns: number; costUsd: number }>>();
    for (const r of modelRows) {
      const arr = modelsBySession.get(r.session_id) ?? [];
      arr.push({
        model: r.model,
        modelKey: resolveModelKey(r.model),
        turns: r.turns,
        costUsd: r.cost_usd ?? 0,
      });
      modelsBySession.set(r.session_id, arr);
    }

    const sidechainBySession = new Map(sidechainRows.map((r) => [r.session_id, r.count]));
    const toolsBySession = new Map(toolRows.map((r) => [r.session_id, r.tool_count]));
    const enrichBySession = new Map(enrichRows.map((r) => [r.session_id, r]));
    const toolErrBySession = new Map(toolErrRows.map((r) => [r.session_id, r.n]));

    const phaseBySession = new Map<string, string>();
    const phaseAgg = new Map<string, Map<string, number>>();
    for (const r of phaseRows) {
      const byPhase = phaseAgg.get(r.session_id) ?? new Map();
      byPhase.set(r.phase, r.turns);
      phaseAgg.set(r.session_id, byPhase);
    }
    for (const [sid, byPhase] of phaseAgg) {
      let best = 'unknown';
      let bestN = 0;
      for (const [p, n] of byPhase) {
        if (n > bestN) { best = p; bestN = n; }
      }
      phaseBySession.set(sid, best);
    }

    let data = sessionRows.map((r) => {
      const modelList = modelsBySession.get(r.id) ?? [];
      modelList.sort((a, b) => b.turns - a.turns);
      const enr = enrichBySession.get(r.id);
      const cacheRead = r.total_cache_read_tokens ?? 0;
      const input = r.total_input_tokens ?? 0;
      const cacheCreate = r.total_cache_creation_tokens ?? 0;
      const denom = cacheRead + input + cacheCreate;
      const cacheHitPct = denom > 0 ? Math.round((cacheRead / denom) * 100) : 0;
      const durationMs = enr ? (enr.ended_at - enr.started_at) : Math.max(0, r.last_active_at - r.started_at);
      return {
        id: r.id,
        projectPath: r.project_path,
        startedAt: r.started_at,
        lastActiveAt: r.last_active_at,
        primaryModel: r.primary_model,
        primaryModelKey: resolveModelKey(r.primary_model),
        gitBranch: r.git_branch,
        turnCount: r.turn_count,
        sidechainTurns: sidechainBySession.get(r.id) ?? 0,
        toolCount: toolsBySession.get(r.id) ?? 0,
        dominantPhase: phaseBySession.get(r.id) ?? 'unknown',
        models: modelList,
        tokens: {
          inputTokens: r.total_input_tokens,
          outputTokens: r.total_output_tokens,
          cacheReadTokens: r.total_cache_read_tokens,
          cacheCreationTokens: r.total_cache_creation_tokens,
        },
        costUsd: r.total_cost_usd,
        cacheHitPct,
        durationMs,
        thinkingTurns: enr?.thinking_turns ?? 0,
        apiErrorTurns: enr?.api_errors ?? 0,
        toolErrorCount: toolErrBySession.get(r.id) ?? 0,
        isEmpty: (r.turn_count ?? 0) === 0,
      };
    });

    if (req.query.model && req.query.model !== 'all') {
      data = data.filter((s) => s.models.some((m) => m.modelKey === req.query.model));
    }

    return reply.send(data);
  });

  // ── SSE: global session list stream ──
  app.get('/sessions/stream', async (req, reply) => {
    openSseStream(reply, req, (evt) => {
      if (evt.type === 'session:created' || evt.type === 'session:updated') {
        writeSseEvent(reply, evt.type, { sessionId: evt.sessionId, at: evt.at });
      }
    });
  });

  // ── SSE: per-session stream ──
  app.get<{ Params: { id: string } }>('/sessions/:id/stream', async (req, reply) => {
    const sid = req.params.id;
    openSseStream(reply, req, (evt) => {
      if (evt.sessionId !== sid) return;
      writeSseEvent(reply, evt.type, {
        sessionId: evt.sessionId,
        at: evt.at,
        ...(evt.type === 'turn:appended' ? { eventId: evt.eventId } : {}),
      });
    });
  });

  // ── Session detail ──
  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const db = getDb();
    const session = db.select().from(sessions).where(eq(sessions.id, req.params.id)).get();
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const events = db.select().from(tokenEvents)
      .where(eq(tokenEvents.sessionId, req.params.id))
      .orderBy(tokenEvents.timestamp)
      .all();

    // Server-side breakdown
    const breakdownRows = db.all<{
      model: string; input: number; output: number; cacheRead: number; cacheCreation: number; cost: number; turns: number;
    }>(sql`
      SELECT model,
             SUM(input_tokens) AS input,
             SUM(output_tokens) AS output,
             SUM(cache_read_tokens) AS cacheRead,
             SUM(cache_creation_tokens) AS cacheCreation,
             SUM(cost_usd) AS cost,
             COUNT(*) AS turns
      FROM token_events
      WHERE session_id = ${req.params.id}
      GROUP BY model
    `);

    const modelBreakdown = Object.fromEntries(breakdownRows.map((r) => [
      r.model,
      {
        inputTokens: r.input ?? 0,
        outputTokens: r.output ?? 0,
        cacheReadTokens: r.cacheRead ?? 0,
        cacheCreationTokens: r.cacheCreation ?? 0,
        costUsd: r.cost ?? 0,
        turns: r.turns ?? 0,
      },
    ]));

    const models = Object.entries(modelBreakdown).map(([model, v]) => ({
      model,
      modelKey: resolveModelKey(model),
      turns: v.turns,
      costUsd: v.costUsd,
    })).sort((a, b) => b.turns - a.turns);

    const sidechainTurns = events.filter((e) => e.isSidechain).length;
    const toolSet = new Set<string>();
    for (const e of events) {
      if (!e.toolsUsed) continue;
      try {
        const arr = JSON.parse(e.toolsUsed) as string[];
        arr.forEach((t) => toolSet.add(t));
      } catch {}
    }

    const phaseCount = new Map<string, number>();
    for (const e of events) {
      if (!e.semanticPhase) continue;
      phaseCount.set(e.semanticPhase, (phaseCount.get(e.semanticPhase) ?? 0) + 1);
    }
    let dominantPhase = 'unknown';
    let dominantCount = 0;
    for (const [p, c] of phaseCount) {
      if (c > dominantCount) { dominantPhase = p; dominantCount = c; }
    }

    const normEvents = events.map((e) => ({
      id: e.id,
      sessionId: e.sessionId,
      timestamp: e.timestamp,
      model: e.model,
      modelKey: resolveModelKey(e.model),
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      cacheReadTokens: e.cacheReadTokens,
      cacheCreationTokens: e.cacheCreationTokens,
      costUsd: e.costUsd,
      toolsUsed: e.toolsUsed ? safeParseArray(e.toolsUsed) : [],
      stopReason: e.stopReason,
      isSidechain: e.isSidechain ?? false,
      parentUuid: e.parentUuid,
      semanticPhase: e.semanticPhase ?? 'unknown',
    }));

    return reply.send({
      id: session.id,
      projectPath: session.projectPath,
      startedAt: session.startedAt,
      lastActiveAt: session.lastActiveAt,
      primaryModel: session.primaryModel,
      primaryModelKey: resolveModelKey(session.primaryModel),
      gitBranch: session.gitBranch,
      version: session.version,
      turnCount: session.turnCount,
      sidechainTurns,
      toolCount: toolSet.size,
      dominantPhase,
      models,
      tokens: {
        inputTokens: session.totalInputTokens,
        outputTokens: session.totalOutputTokens,
        cacheReadTokens: session.totalCacheReadTokens,
        cacheCreationTokens: session.totalCacheCreationTokens,
      },
      costUsd: session.totalCostUsd,
      events: normEvents,
      modelBreakdown,
    });
  });

  // ── Session graph (parent/child + sidechain edges) ──
  app.get<{ Params: { id: string } }>('/sessions/:id/graph', async (req, reply) => {
    const db = getDb();
    const events = db.select().from(tokenEvents)
      .where(eq(tokenEvents.sessionId, req.params.id))
      .orderBy(tokenEvents.timestamp)
      .all();

    // Pre-aggregate hooks + file changes by eventId.
    const hookCounts = new Map<number, number>();
    for (const row of db.all<{ event_id: number; n: number }>(sql`
      SELECT event_id, COUNT(*) AS n FROM turn_hooks
      WHERE session_id = ${req.params.id} AND event_id IS NOT NULL
      GROUP BY event_id
    `)) {
      hookCounts.set(row.event_id, row.n);
    }
    const fileCounts = new Map<number, number>();
    for (const row of db.all<{ event_id: number; n: number }>(sql`
      SELECT event_id, COUNT(*) AS n FROM turn_file_changes
      WHERE session_id = ${req.params.id} AND event_id IS NOT NULL
      GROUP BY event_id
    `)) {
      fileCounts.set(row.event_id, row.n);
    }

    // Per-event tool error counts (from turn_tool_calls)
    const toolErrorCounts = new Map<number, number>();
    for (const row of db.all<{ event_id: number; n: number }>(sql`
      SELECT tt.event_id AS event_id, COUNT(*) AS n
      FROM turn_tool_calls tt
      JOIN token_events te ON te.id = tt.event_id
      WHERE te.session_id = ${req.params.id} AND tt.result_is_error = 1
      GROUP BY tt.event_id
    `)) {
      toolErrorCounts.set(row.event_id, row.n);
    }

    // Parent event_id lookup: map parent_uuid → event_id for same session
    const uuidToEventId = new Map<string, number>();
    for (const e of events) if (e.uuid) uuidToEventId.set(e.uuid, e.id);

    const nodes: SessionGraphNodeDTO[] = events.map((e, idx) => {
      const cacheRead = e.cacheReadTokens ?? 0;
      const input = e.inputTokens ?? 0;
      const cacheCreate = e.cacheCreationTokens ?? 0;
      const denom = cacheRead + input + cacheCreate;
      const cacheHitPct = denom > 0 ? Math.round((cacheRead / denom) * 100) : 0;
      return {
        id: String(e.id),
        turnIdx: idx,
        model: e.model,
        modelKey: resolveModelKey(e.model) as SessionGraphNodeDTO['modelKey'],
        isSidechain: !!e.isSidechain,
        phase: (e.semanticPhase ?? 'unknown') as SessionGraphNodeDTO['phase'],
        tools: e.toolsUsed ? safeParseArray(e.toolsUsed) : [],
        tokens: (e.inputTokens ?? 0) + (e.outputTokens ?? 0),
        inputTokens: input,
        outputTokens: e.outputTokens ?? 0,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreate,
        cacheHitPct,
        stopReason: e.stopReason ?? null,
        costUsd: e.costUsd,
        parentId: e.parentUuid ?? null,
        timestamp: e.timestamp,
        requestId: (e as any).requestId ?? null,
        slug: (e as any).slug ?? null,
        messageId: (e as any).messageId ?? null,
        apiErrorStatus: (e as any).apiErrorStatus ?? null,
        isApiError: !!(e as any).isApiError,
        serviceTier: (e as any).serviceTier ?? null,
        speed: (e as any).speed ?? null,
        cache1h: (e as any).cache1hTokens ?? 0,
        cache5m: (e as any).cache5mTokens ?? 0,
        webSearchCount: (e as any).webSearchCount ?? 0,
        webFetchCount: (e as any).webFetchCount ?? 0,
        iterationsCount: (e as any).iterationsCount ?? 0,
        durationMs: (e as any).durationMs ?? null,
        permissionMode: (e as any).permissionMode ?? null,
        hasThinking: !!(e as any).hasThinking,
        hooksCount: hookCounts.get(e.id) ?? 0,
        filesChangedCount: fileCounts.get(e.id) ?? 0,
        isMeta: !!(e as any).isMeta,
        isCompactSummary: !!(e as any).isCompactSummary,
        toolsErrorCount: toolErrorCounts.get(e.id) ?? 0,
        cwd: (e as any).cwd ?? null,
        gitBranch: (e as any).gitBranch ?? null,
      };
    });

    const edges: SessionGraphDTO['edges'] = [];
    for (let i = 1; i < events.length; i++) {
      edges.push({
        from: String(events[i - 1].id),
        to: String(events[i].id),
        kind: events[i].isSidechain ? 'sidechain' : 'chain',
      });
    }

    const payload: SessionGraphDTO = { nodes, edges };
    return reply.send(payload);
  });

  // ── Turn pair (drawer: user + assistant as coherent block) ──
  app.get<{ Params: { id: string; eventId: string } }>(
    '/sessions/:id/turns/:eventId/content',
    async (req, reply) => {
      const db = getDb();
      const eventId = parseInt(req.params.eventId, 10);
      if (!Number.isFinite(eventId)) return reply.status(400).send({ error: 'Invalid eventId' });

      const rows = db.select().from(turnContent).where(eq(turnContent.eventId, eventId)).all();
      const assistantRow = rows.find((r) => r.role === 'assistant');
      if (!assistantRow) return reply.status(404).send({ error: 'Turn content not found' });

      const payload = extractTurnContent(assistantRow.content, 'assistant');
      const assistantEvent = db.select().from(tokenEvents).where(eq(tokenEvents.id, eventId)).get();

      // Structured tool calls (v9) — full payloads, not preview-truncated
      const toolCallRows = db.select().from(turnToolCalls)
        .where(eq(turnToolCalls.eventId, eventId))
        .all();
      const toolCallsStructured: ToolCallStructuredDTO[] = toolCallRows
        .sort((a, b) => a.orderIdx - b.orderIdx)
        .map((r) => ({
          toolUseId: r.toolUseId,
          toolName: r.toolName,
          orderIdx: r.orderIdx,
          inputJson: r.inputJson ?? null,
          resultIsError: r.resultIsError ?? null,
          resultContent: r.resultContent ?? null,
          resultStderr: r.resultStderr ?? null,
          resultStdout: r.resultStdout ?? null,
          resultExitCode: r.resultExitCode ?? null,
        }));

      // Resolve parent event id for clickable link
      let parentEventId: number | null = null;
      if (assistantEvent?.parentUuid && assistantEvent.sessionId) {
        const parentRow = db.all<{ id: number }>(sql`
          SELECT id FROM token_events
          WHERE session_id = ${assistantEvent.sessionId} AND uuid = ${assistantEvent.parentUuid}
          LIMIT 1
        `)[0];
        parentEventId = parentRow?.id ?? null;
      }

      // Enrich toolCalls with toolUseResult from persisted tool_result rows for this turn.
      const toolResultRows = rows.filter((r) => r.role === 'tool_result');
      for (const tr of toolResultRows) {
        applyToolResultsFromUser(payload.toolCalls, tr.content);
      }

      // Files changed + hooks for this assistant turn.
      const filesChanged = db.all<{ file_path: string }>(sql`
        SELECT DISTINCT file_path FROM turn_file_changes
        WHERE event_id = ${eventId}
        ORDER BY file_path
      `).map((r) => r.file_path);
      const hooks: TurnHookDTO[] = db.all<any>(sql`
        SELECT hook_name, hook_event, exit_code, duration_ms, stderr
        FROM turn_hooks WHERE event_id = ${eventId}
        ORDER BY timestamp ASC
      `).map((r) => ({
        name: r.hook_name,
        event: r.hook_event,
        exitCode: r.exit_code ?? null,
        durationMs: r.duration_ms ?? null,
        stderr: r.stderr ?? null,
      }));

      let userContent: TurnPairDTO['userEvent'] = null;
      const userRow = rows.find((r) => r.role === 'user');
      if (userRow) {
        const userPayload = extractTurnContent(userRow.content, 'user');
        userContent = {
          eventId,
          role: 'user' as const,
          userPrompt: userPayload.userPrompt,
          byteSize: userRow.byteSize,
        };
      }

      const dto: TurnPairDTO = {
        userEvent: userContent,
        assistantEvent: {
          eventId,
          role: 'assistant' as const,
          assistantText: payload.assistantText,
          toolCalls: payload.toolCalls,
          agentRole: assistantEvent?.agentRole ?? null,
          byteSize: assistantRow.byteSize,
          thinkingBlocks: payload.thinkingBlocks,
          filesChanged: filesChanged.length > 0 ? filesChanged : undefined,
          hooks: hooks.length > 0 ? hooks : undefined,
          permissionMode: (assistantEvent as any)?.permissionMode ?? null,
          requestId: (assistantEvent as any)?.requestId ?? null,
          slug: (assistantEvent as any)?.slug ?? null,
          apiErrorStatus: (assistantEvent as any)?.apiErrorStatus ?? null,
          isApiError: !!(assistantEvent as any)?.isApiError,
          thinkingText: (assistantEvent as any)?.thinkingText ?? null,
          cwd: (assistantEvent as any)?.cwd ?? null,
          gitBranch: (assistantEvent as any)?.gitBranch ?? null,
          promptId: (assistantEvent as any)?.promptId ?? null,
          isMeta: !!(assistantEvent as any)?.isMeta,
          isCompactSummary: !!(assistantEvent as any)?.isCompactSummary,
          parentEventId,
          toolCallsStructured: toolCallsStructured.length ? toolCallsStructured : undefined,
        },
      };
      return reply.send(dto);
    },
  );

  // ── Git stats (cached w/ 60s TTL) ──
  const gitStatsCache = new Map<string, { at: number; data: any }>();
  app.get<{ Params: { id: string } }>('/sessions/:id/git-stats', async (req, reply) => {
    const cached = gitStatsCache.get(req.params.id);
    if (cached && Date.now() - cached.at < 60_000) return reply.send(cached.data);

    const db = getDb();
    const session = db.select().from(sessions).where(eq(sessions.id, req.params.id)).get();
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const projectPath = resolve(session.projectPath);
    const empty = { insertions: 0, deletions: 0, filesChanged: 0, available: false };
    if (!existsSync(projectPath)) return reply.send(empty);

    try {
      const startISO = new Date(session.startedAt).toISOString();
      const endISO = new Date(session.lastActiveAt + 5 * 60_000).toISOString();
      const output = execSync(
        `git -C "${projectPath}" log --numstat --format="" --after="${startISO}" --before="${endISO}"`,
        { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 },
      );

      let insertions = 0, deletions = 0;
      const filesChanged = new Set<string>();
      for (const line of output.split('\n')) {
        const parts = line.trim().split('\t');
        if (parts.length >= 3) {
          const ins = parseInt(parts[0], 10);
          const dels = parseInt(parts[1], 10);
          if (!isNaN(ins) && !isNaN(dels)) {
            insertions += ins; deletions += dels;
            if (parts[2]) filesChanged.add(parts[2]);
          }
        }
      }

      const data = { insertions, deletions, filesChanged: filesChanged.size, available: true };
      gitStatsCache.set(req.params.id, { at: Date.now(), data });
      return reply.send(data);
    } catch {
      return reply.send(empty);
    }
  });

  // ── Manual sync trigger (called from hooks after each turn) ──
  app.post<{ Body: { sessionId?: string; filePath?: string } }>('/sessions/sync', async (req, reply) => {
    const { sessionId, filePath } = req.body ?? {};

    let target = filePath;

    if (!target && sessionId) {
      const db = getDb();
      const row = db.select({ jsonlFile: sessions.jsonlFile }).from(sessions)
        .where(eq(sessions.id, sessionId)).get();
      target = row?.jsonlFile ?? undefined;
    }

    if (!target) {
      return reply.status(400).send({ error: 'Provide sessionId or filePath' });
    }

    if (!existsSync(target)) {
      return reply.status(404).send({ error: 'File not found', path: target });
    }

    try {
      await syncFile(target);
      return reply.send({ ok: true, path: target });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });
}

function writeSseEvent(reply: any, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  if (typeof reply.raw.flush === 'function') reply.raw.flush();
}

function openSseStream(
  reply: any,
  req: any,
  onEvent: (evt: SessionBusEvent) => void,
): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.flushHeaders();
  reply.raw.write(': connected\n\n');

  const unsubscribe = sessionBus.subscribe(onEvent);
  const keepalive = setInterval(() => {
    try { reply.raw.write(': keepalive\n\n'); } catch {}
  }, 15_000);

  const close = () => {
    clearInterval(keepalive);
    unsubscribe();
    try { reply.raw.end(); } catch {}
  };
  req.raw.on('close', close);
  req.raw.on('error', close);
}

function safeParseArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const PREVIEW_CHARS = 8000;

function truncate(s: string, n = PREVIEW_CHARS): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function extractTurnContent(
  raw: string,
  role: 'user' | 'assistant',
): Pick<TurnContentDTO, 'assistantText' | 'userPrompt' | 'toolCalls' | 'thinkingBlocks'> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }

  const blocks: any[] = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).content))
      ? (parsed as any).content
      : [];

  let assistantText: string | null = null;
  let userPrompt: string | null = null;
  const toolCalls: TurnToolCall[] = [];
  const thinkingBlocks: ThinkingBlockDTO[] = [];

  if (typeof parsed === 'string') {
    if (role === 'assistant') assistantText = parsed;
    else userPrompt = parsed;
  }

  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    const type = b.type as string | undefined;
    if (type === 'thinking') {
      const text = typeof b.thinking === 'string' && b.thinking.length > 0
        ? truncate(b.thinking, 2000)
        : '[thinking redacted by Claude Code — only signature stored]';
      thinkingBlocks.push({ text, signature: typeof b.signature === 'string' ? b.signature.slice(0, 60) + '…' : undefined });
      continue;
    }
    if (type === 'text' && typeof b.text === 'string') {
      if (role === 'assistant') {
        assistantText = (assistantText ? assistantText + '\n\n' : '') + b.text;
      } else {
        userPrompt = (userPrompt ? userPrompt + '\n\n' : '') + b.text;
      }
    } else if (type === 'tool_use') {
      toolCalls.push({
        tool: b.name ?? 'unknown',
        toolUseId: typeof b.id === 'string' ? b.id : undefined,
        inputPreview: truncate(JSON.stringify(b.input ?? {}, null, 2), 400),
        resultPreview: null,
      });
    } else if (type === 'tool_result') {
      const content = typeof b.content === 'string'
        ? b.content
        : Array.isArray(b.content)
          ? b.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('\n')
          : JSON.stringify(b.content ?? '');
      const last = toolCalls[toolCalls.length - 1];
      if (last && !last.resultPreview) {
        last.resultPreview = truncate(content, 400);
        last.isError = !!b.is_error;
      } else {
        toolCalls.push({
          tool: 'result',
          inputPreview: '',
          resultPreview: truncate(content, 400),
          isError: !!b.is_error,
        });
      }
    }
  }

  return { assistantText, userPrompt, toolCalls, thinkingBlocks: thinkingBlocks.length ? thinkingBlocks : undefined };
}

/**
 * Parse the *next* user-turn content and match its tool_result blocks +
 * top-level toolUseResult metadata onto the assistant's tool calls by toolUseId.
 * The user event itself (row) stored in turn_content is the `message.content`
 * array only — we don't have access to the event-level `toolUseResult` here,
 * so stderr/exitCode/interrupted can be recovered via parsing the result
 * content. Bash exit codes appear inline via <stderr>/<is_error>; a richer
 * fix would widen turn_content schema to include toolUseResult fields. For
 * now we enrich isError / resultPreview from message.content blocks.
 */
function applyToolResultsFromUser(toolCalls: TurnToolCall[], userContentRaw: string): void {
  let parsed: unknown;
  try { parsed = JSON.parse(userContentRaw); } catch { return; }

  const blocks: any[] = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).content))
      ? (parsed as any).content
      : [];

  const byId = new Map<string, TurnToolCall>();
  for (const tc of toolCalls) if (tc.toolUseId) byId.set(tc.toolUseId, tc);

  for (const b of blocks) {
    if (!b || typeof b !== 'object' || b.type !== 'tool_result') continue;
    const match = typeof b.tool_use_id === 'string' ? byId.get(b.tool_use_id) : undefined;
    if (!match) continue;
    match.isError = !!b.is_error;
    if (!match.resultPreview) {
      const content = typeof b.content === 'string'
        ? b.content
        : Array.isArray(b.content)
          ? b.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('\n')
          : JSON.stringify(b.content ?? '');
      match.resultPreview = truncate(content, 400);
    }
  }
}
