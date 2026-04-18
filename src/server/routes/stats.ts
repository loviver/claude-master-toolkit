import type { FastifyInstance } from 'fastify';
import { desc, sql, gte } from 'drizzle-orm';
import { getDb } from '../db/db.js';
import { sessions, tokenEvents } from '../db/schema.js';
import { resolveModelKey } from '../../shared/pricing.js';

interface StatsQuery {
  sessionId?: string;
  range?: string;
  project?: string;
  model?: string;
}

function rangeCutoff(range?: string): number | null {
  switch (range) {
    case '1d':  return Date.now() - 86_400_000;
    case '7d':  return Date.now() - 7 * 86_400_000;
    case '30d': return Date.now() - 30 * 86_400_000;
    case '90d': return Date.now() - 90 * 86_400_000;
    default:    return null;
  }
}

function buildFilter(q: StatsQuery) {
  const cutoff = rangeCutoff(q.range);
  const parts: any[] = [];
  if (q.sessionId) parts.push(sql`session_id = ${q.sessionId}`);
  if (cutoff) parts.push(sql`timestamp >= ${cutoff}`);
  if (q.project) {
    parts.push(sql`session_id IN (SELECT id FROM sessions WHERE project_path = ${q.project})`);
  }
  if (q.model && q.model !== 'all') {
    parts.push(sql`(model LIKE ${'%' + q.model + '%'})`);
  }
  return parts.length ? sql` AND ${sql.join(parts, sql` AND `)}` : sql``;
}

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  // ── Current overview ──
  app.get<{ Querystring: StatsQuery }>('/stats/current', async (req, reply) => {
    const db = getDb();
    const cutoff = rangeCutoff(req.query.range);

    const base = db.select().from(sessions).orderBy(desc(sessions.lastActiveAt));
    const latestSession = base.limit(1).get();

    const totalRow = db.get<{ count: number; cost: number; turns: number; projects: number }>(sql`
      SELECT COUNT(*) AS count,
             COALESCE(SUM(total_cost_usd), 0) AS cost,
             COALESCE(SUM(turn_count), 0) AS turns,
             COUNT(DISTINCT project_path) AS projects
      FROM sessions
      WHERE 1=1 ${cutoff ? sql`AND last_active_at >= ${cutoff}` : sql``}
        ${req.query.project ? sql`AND project_path = ${req.query.project}` : sql``}
    `);

    const count = totalRow?.count ?? 0;
    const cost = totalRow?.cost ?? 0;

    return reply.send({
      latestSession: latestSession ? {
        id: latestSession.id,
        projectPath: latestSession.projectPath,
        primaryModel: latestSession.primaryModel,
        primaryModelKey: resolveModelKey(latestSession.primaryModel),
        costUsd: latestSession.totalCostUsd,
        turnCount: latestSession.turnCount,
        lastActiveAt: latestSession.lastActiveAt,
      } : null,
      totalSessions: count,
      totalCostUsd: cost,
      totalTurns: totalRow?.turns ?? 0,
      avgCostPerSession: count > 0 ? cost / count : 0,
      activeProjects: totalRow?.projects ?? 0,
    });
  });

  // ── Timeline (daily) ──
  app.get<{ Querystring: StatsQuery }>('/stats/timeline', async (req, reply) => {
    const db = getDb();
    const cutoff = rangeCutoff(req.query.range) ?? Date.now() - 7 * 86_400_000;

    const rows = db.all<any>(sql`
      SELECT date(timestamp / 1000, 'unixepoch') AS date,
             SUM(cost_usd) AS costUsd,
             SUM(input_tokens) AS inputTokens,
             SUM(output_tokens) AS outputTokens,
             SUM(cache_read_tokens) AS cacheReadTokens,
             COUNT(DISTINCT session_id) AS sessions
      FROM token_events
      WHERE timestamp >= ${cutoff}
        ${req.query.project ? sql`AND session_id IN (SELECT id FROM sessions WHERE project_path = ${req.query.project})` : sql``}
      GROUP BY date(timestamp / 1000, 'unixepoch')
      ORDER BY date(timestamp / 1000, 'unixepoch')
    `);

    return reply.send(rows);
  });

  // ── Model breakdown ──
  app.get<{ Querystring: StatsQuery }>('/stats/models', async (req, reply) => {
    const db = getDb();
    const filter = buildFilter(req.query);

    const rows = db.all<any>(sql`
      SELECT model,
             SUM(input_tokens) AS totalInput,
             SUM(output_tokens) AS totalOutput,
             SUM(cache_read_tokens) AS totalCacheRead,
             SUM(cache_creation_tokens) AS totalCacheCreation,
             SUM(cost_usd) AS costUsd,
             COUNT(*) AS turns,
             COUNT(DISTINCT session_id) AS sessionCount
      FROM token_events
      WHERE 1=1 ${filter}
      GROUP BY model
    `);

    const totalCost = rows.reduce((a, r) => a + (r.costUsd ?? 0), 0);
    const data = rows.map((r) => ({
      model: r.model,
      modelKey: resolveModelKey(r.model),
      totalTokens: (r.totalInput ?? 0) + (r.totalOutput ?? 0) + (r.totalCacheRead ?? 0) + (r.totalCacheCreation ?? 0),
      tokens: {
        input: r.totalInput ?? 0,
        output: r.totalOutput ?? 0,
        cacheRead: r.totalCacheRead ?? 0,
        cacheCreation: r.totalCacheCreation ?? 0,
      },
      costUsd: r.costUsd ?? 0,
      turns: r.turns ?? 0,
      sessionCount: r.sessionCount ?? 0,
      percentage: totalCost > 0 ? ((r.costUsd ?? 0) / totalCost) * 100 : 0,
    }));

    return reply.send(data);
  });

  // ── Tool efficiency ──
  app.get<{ Querystring: StatsQuery }>('/stats/efficiency', async (req, reply) => {
    const db = getDb();
    const filter = buildFilter(req.query);

    const rows = db.all<any>(sql`
      WITH tool_rows AS (
        SELECT json_each.value AS tool, input_tokens, output_tokens, cost_usd
        FROM token_events, json_each(tools_used)
        WHERE tools_used IS NOT NULL ${filter}
      )
      SELECT tool,
             COUNT(*) AS count,
             ROUND(AVG(input_tokens), 0) AS avgInput,
             ROUND(AVG(output_tokens), 0) AS avgOutput,
             ROUND(AVG(cost_usd), 6) AS avgCost
      FROM tool_rows
      GROUP BY tool
      ORDER BY count DESC
    `);

    const overall = db.get<any>(sql`
      SELECT ROUND(AVG(input_tokens + output_tokens), 0) AS avgTokens,
             ROUND(AVG(cost_usd), 6) AS avgCost
      FROM token_events
      WHERE tools_used IS NOT NULL ${filter}
    `);

    return reply.send({
      perTool: Object.fromEntries(rows.map((r) => [r.tool, {
        count: r.count,
        avgInputTokens: r.avgInput,
        avgOutputTokens: r.avgOutput,
        avgCostUsd: r.avgCost,
      }])),
      overall: {
        avgTokensPerTurn: overall?.avgTokens ?? 0,
        avgCostPerTurn: overall?.avgCost ?? 0,
      },
    });
  });

  // ── Phases ──
  app.get<{ Querystring: StatsQuery }>('/stats/phases', async (req, reply) => {
    const db = getDb();
    const filter = buildFilter(req.query);

    const rows = db.all<any>(sql`
      SELECT semantic_phase AS phase,
             COUNT(*) AS turns,
             SUM(input_tokens + output_tokens) AS tokens
      FROM token_events
      WHERE semantic_phase IS NOT NULL ${filter}
      GROUP BY semantic_phase
    `);

    const total = rows.reduce((a, r) => a + r.turns, 0);
    const data = Object.fromEntries(rows.map((r) => [r.phase, {
      turns: r.turns,
      pct: total > 0 ? Math.round((r.turns / total) * 100) : 0,
      tokens: r.tokens,
    }]));
    return reply.send(data);
  });

  // ── Tools frequency + combos ──
  app.get<{ Querystring: StatsQuery }>('/stats/tools', async (req, reply) => {
    const db = getDb();
    const filter = buildFilter(req.query);

    const freqRows = db.all<any>(sql`
      SELECT json_each.value AS tool, COUNT(*) AS count
      FROM token_events, json_each(tools_used)
      WHERE tools_used IS NOT NULL ${filter}
      GROUP BY tool
      ORDER BY count DESC
    `);

    const comboRows = db.all<any>(sql`
      SELECT tools_used AS combo, COUNT(*) AS count
      FROM token_events
      WHERE tools_used IS NOT NULL
        AND json_array_length(tools_used) >= 2
        ${filter}
      GROUP BY tools_used
      ORDER BY count DESC
      LIMIT 10
    `);

    return reply.send({
      frequency: Object.fromEntries(freqRows.map((r) => [r.tool, r.count])),
      combos: comboRows.map((r) => ({
        tools: safeArray(r.combo),
        count: r.count,
      })),
    });
  });

  // ── Efficiency score ──
  app.get<{ Querystring: StatsQuery }>('/stats/score', async (req, reply) => {
    const db = getDb();
    const filter = buildFilter(req.query);

    const metrics = db.get<any>(sql`
      SELECT ROUND(AVG(input_tokens + output_tokens), 0) AS avgTokensPerTurn,
             COUNT(*) AS totalTurns,
             SUM(cache_read_tokens) AS totalCacheRead,
             SUM(input_tokens + cache_creation_tokens) AS totalInput,
             SUM(CASE WHEN semantic_phase = 'exploration' THEN 1 ELSE 0 END) AS explorationTurns,
             SUM(CASE WHEN semantic_phase = 'implementation' THEN 1 ELSE 0 END) AS implementationTurns,
             SUM(CASE WHEN semantic_phase = 'testing' THEN 1 ELSE 0 END) AS testingTurns,
             SUM(CASE WHEN stop_reason = 'max_tokens' THEN 1 ELSE 0 END) AS maxTokenHits
      FROM token_events
      WHERE 1=1 ${filter}
    `);

    if (!metrics || metrics.totalTurns === 0) {
      return reply.send({ sessionId: req.query.sessionId ?? 'all', score: 0, breakdown: { tokensPerTurn: 0, cacheHitRatio: 0, errorRecovery: 0, phaseBalance: 0 } });
    }

    const tptScore = Math.max(0, Math.min(100, Math.round(100 - ((metrics.avgTokensPerTurn - 2000) / 180))));

    const denom = (metrics.totalCacheRead ?? 0) + (metrics.totalInput ?? 0);
    const cacheRatio = denom > 0 ? (metrics.totalCacheRead ?? 0) / denom : 0;
    const cacheScore = Math.round(Math.min(100, cacheRatio * 100));

    const total = metrics.totalTurns;
    const expPct = metrics.explorationTurns / total;
    const impPct = metrics.implementationTurns / total;
    const testPct = metrics.testingTurns / total;
    const distance = Math.abs(expPct - 0.2) + Math.abs(impPct - 0.6) + Math.abs(testPct - 0.2);
    const phaseScore = Math.round(Math.max(0, 100 - distance * 100));

    const errorRate = metrics.maxTokenHits / total;
    const errorRecovery = Math.round(Math.max(0, 100 - errorRate * 200));

    const score = Math.round((tptScore + cacheScore + phaseScore + errorRecovery) / 4);

    return reply.send({
      sessionId: req.query.sessionId ?? 'all',
      score,
      breakdown: {
        tokensPerTurn: tptScore,
        cacheHitRatio: cacheScore,
        errorRecovery,
        phaseBalance: phaseScore,
      },
    });
  });

  // ── Projects (per-project rollup) ──
  app.get<{ Querystring: StatsQuery }>('/stats/projects', async (req, reply) => {
    const db = getDb();
    const cutoff = rangeCutoff(req.query.range);

    const rows = db.all<any>(sql`
      SELECT s.project_path AS projectPath,
             COUNT(DISTINCT s.id) AS sessionCount,
             SUM(s.turn_count) AS turnCount,
             SUM(s.total_cost_usd) AS costUsd,
             MAX(s.last_active_at) AS lastActiveAt
      FROM sessions s
      WHERE 1=1 ${cutoff ? sql`AND s.last_active_at >= ${cutoff}` : sql``}
      GROUP BY s.project_path
      ORDER BY SUM(s.total_cost_usd) DESC
      LIMIT 50
    `);

    const result = rows.map((r) => {
      const dom = db.get<any>(sql`
        SELECT model FROM token_events
        WHERE session_id IN (SELECT id FROM sessions WHERE project_path = ${r.projectPath})
        GROUP BY model
        ORDER BY COUNT(*) DESC
        LIMIT 1
      `);
      const segments = String(r.projectPath).split('/').filter(Boolean);
      return {
        projectPath: r.projectPath,
        projectName: segments.at(-1) ?? r.projectPath,
        sessionCount: r.sessionCount,
        turnCount: r.turnCount ?? 0,
        costUsd: r.costUsd ?? 0,
        lastActiveAt: r.lastActiveAt,
        dominantModel: dom ? resolveModelKey(dom.model) : 'unknown',
      };
    });

    return reply.send(result);
  });

  // ── Activity heatmap (day-of-week × hour-of-day) ──
  app.get<{ Querystring: StatsQuery }>('/stats/activity', async (req, reply) => {
    const db = getDb();
    const cutoff = rangeCutoff(req.query.range) ?? Date.now() - 30 * 86_400_000;

    const rows = db.all<any>(sql`
      SELECT CAST(strftime('%w', timestamp / 1000, 'unixepoch') AS INTEGER) AS dow,
             CAST(strftime('%H', timestamp / 1000, 'unixepoch') AS INTEGER) AS hour,
             COUNT(*) AS turns,
             SUM(cost_usd) AS costUsd
      FROM token_events
      WHERE timestamp >= ${cutoff}
      GROUP BY dow, hour
    `);

    return reply.send(rows);
  });

  // ── Aggregated dashboard bundle — single round-trip ──
  app.get<{ Querystring: StatsQuery }>('/stats/dashboard', async (req, reply) => {
    // Compose by calling the other handlers' internals. Simpler: fetch inline.
    const [current, timeline, models, phases, tools, efficiency, projects] = await Promise.all([
      inject(app, '/api/stats/current', req.query),
      inject(app, '/api/stats/timeline', req.query),
      inject(app, '/api/stats/models', req.query),
      inject(app, '/api/stats/phases', req.query),
      inject(app, '/api/stats/tools', req.query),
      inject(app, '/api/stats/score', req.query),
      inject(app, '/api/stats/projects', req.query),
    ]);

    return reply.send({ current, timeline, models, phases, tools, efficiency, projects });
  });
}

async function inject(app: FastifyInstance, url: string, query: Record<string, any>): Promise<any> {
  const qs = Object.entries(query)
    .filter(([_, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  const full = qs ? `${url}?${qs}` : url;
  const res = await app.inject({ method: 'GET', url: full });
  try { return JSON.parse(res.body); } catch { return null; }
}

function safeArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
