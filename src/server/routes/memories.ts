import type { FastifyInstance } from 'fastify';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { writeFileSync, existsSync } from 'fs';
import { getDb } from '../db/db.js';
import { memoriesV2 as memories } from '../db/schema.js';

type MemoryRow = typeof memories.$inferSelect;
function projectMemory(row: MemoryRow): MemoryRow & { content: string } {
  return { ...row, content: row.what ?? '' };
}

export async function memoriesRoutes(app: FastifyInstance): Promise<void> {
  // List all memories
  app.get<{ Querystring: { type?: string; search?: string; project?: string } }>(
    '/memories',
    async (req, reply) => {
      const db = getDb();
      const conditions = [];

      if (req.query.type) {
        conditions.push(eq(memories.type, req.query.type));
      }
      if (req.query.project) {
        conditions.push(eq(memories.projectPath, req.query.project));
      }
      if (req.query.search) {
        const s = `%${req.query.search}%`;
        conditions.push(or(like(memories.title, s), like(memories.what, s), like(memories.topicKey, s)));
      }

      const rows = db
        .select()
        .from(memories)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(memories.updatedAt))
        .all();

      return reply.send(rows.map(projectMemory));
    },
  );

  // Get single memory (with access tracking)
  app.get<{ Params: { id: string } }>('/memories/:id', async (req, reply) => {
    const db = getDb();
    const memory = db.select().from(memories).where(eq(memories.id, req.params.id)).get();

    if (!memory) {
      return reply.status(404).send({ error: 'Memory not found' });
    }

    // Track access
    db.update(memories)
      .set({
        accessCount: (memory.accessCount || 0) + 1,
        accessedAt: Date.now(),
      })
      .where(eq(memories.id, req.params.id))
      .run();

    return reply.send(projectMemory(memory));
  });

  // Create memory
  app.post<{
    Body: {
      title: string;
      type: string;
      scope?: string;
      topicKey?: string;
      description?: string;
      content: string;
      projectPath?: string;
      filePath?: string;
      sessionId?: string;
    };
  }>('/memories', async (req, reply) => {
    const db = getDb();
    const id = randomUUID();
    const now = Date.now();

    db.insert(memories)
      .values({
        id,
        title: req.body.title,
        type: req.body.type,
        scope: req.body.scope ?? 'project',
        topicKey: req.body.topicKey,
        description: req.body.description,
        what: req.body.content,
        projectPath: req.body.projectPath,
        filePath: req.body.filePath,
        sessionId: req.body.sessionId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return reply.status(201).send({ id, created: true });
  });

  // Update memory
  app.patch<{
    Params: { id: string };
    Body: Partial<{
      title: string;
      type: string;
      scope: string;
      topicKey: string;
      description: string;
      what: string;
      projectPath: string;
    }>;
  }>('/memories/:id', async (req, reply) => {
    const db = getDb();
    const existing = db.select().from(memories).where(eq(memories.id, req.params.id)).get();

    if (!existing) {
      return reply.status(404).send({ error: 'Memory not found' });
    }

    db.update(memories)
      .set({
        ...req.body,
        updatedAt: Date.now(),
      })
      .where(eq(memories.id, req.params.id))
      .run();

    return reply.send({ updated: true });
  });

  // Sync memory to disk (.md file)
  app.post<{
    Params: { id: string };
  }>('/memories/:id/sync', async (req, reply) => {
    const db = getDb();
    const memory = db.select().from(memories).where(eq(memories.id, req.params.id)).get();

    if (!memory) {
      return reply.status(404).send({ error: 'Memory not found' });
    }

    if (!memory.filePath) {
      return reply.status(400).send({ error: 'No file path associated with this memory' });
    }

    if (!existsSync(memory.filePath)) {
      return reply.status(400).send({ error: 'File does not exist on disk' });
    }

    // Write back to markdown with frontmatter
    const frontmatter = [
      '---',
      `name: ${memory.title}`,
      `description: ${memory.description || ''}`,
      `type: ${memory.type}`,
      memory.topicKey ? `topicKey: ${memory.topicKey}` : null,
      memory.sessionId ? `originSessionId: ${memory.sessionId}` : null,
      '---',
    ]
      .filter(Boolean)
      .join('\n');

    const content = `${frontmatter}\n\n${memory.what ?? ''}`;

    try {
      writeFileSync(memory.filePath, content, 'utf-8');
      return reply.send({ synced: true });
    } catch (e) {
      console.error(`[memories] Error syncing to ${memory.filePath}:`, e);
      return reply.status(500).send({ error: 'Failed to write file' });
    }
  });

  // Delete memory
  app.delete<{ Params: { id: string } }>('/memories/:id', async (req, reply) => {
    const db = getDb();
    db.delete(memories).where(eq(memories.id, req.params.id)).run();
    return reply.send({ deleted: true });
  });

  // ── ROI analytics (Pandorica v2) ──

  // Memory ROI — which memories save the most tokens on reuse
  app.get<{ Querystring: { project?: string; limit?: string } }>(
    '/memories/stats/roi',
    async (req, reply) => {
      const db = getDb();
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
      const rows = db.all<{
        topic_key: string | null;
        id: string;
        title: string;
        access_count: number;
        cost_saved_usd: number;
        avg_saving_per_hit: number;
      }>(sql`
        SELECT topic_key, id, title, access_count, cost_saved_usd,
               (cost_saved_usd / NULLIF(access_count, 0)) AS avg_saving_per_hit
        FROM memories_v2
        WHERE access_count > 0
          ${req.query.project ? sql`AND project_path = ${req.query.project}` : sql``}
        ORDER BY cost_saved_usd DESC
        LIMIT ${limit}
      `);
      return reply.send({ count: rows.length, rows });
    },
  );

  // Cost per session — which sessions paid for memory
  app.get('/memories/stats/cost-per-session', async (_req, reply) => {
    const db = getDb();
    const rows = db.all<{
      session_id: string;
      total_cost: number;
      memories_created: number;
      memories_searched: number;
    }>(sql`
      SELECT
        s.id AS session_id,
        COALESCE(SUM(te.cost_usd), 0) AS total_cost,
        COUNT(DISTINCT m.id) AS memories_created,
        COUNT(DISTINCT ms.id) AS memories_searched
      FROM sessions s
      LEFT JOIN token_events te ON te.session_id = s.id
      LEFT JOIN memories_v2 m ON m.session_id = s.id
      LEFT JOIN memory_searches ms ON ms.session_id = s.id
      GROUP BY s.id
      ORDER BY total_cost DESC
      LIMIT 50
    `);
    return reply.send({ count: rows.length, rows });
  });

  // Anomalies — high-cost sessions that never consulted memory
  app.get('/memories/stats/anomalies', async (_req, reply) => {
    const db = getDb();
    const rows = db.all<{ id: string; cost: number; searches: number }>(sql`
      SELECT s.id, COALESCE(SUM(te.cost_usd), 0) AS cost, COUNT(ms.id) AS searches
      FROM sessions s
      JOIN token_events te ON te.session_id = s.id
      LEFT JOIN memory_searches ms ON ms.session_id = s.id
      GROUP BY s.id
      HAVING cost > (SELECT AVG(cost_usd) * 2 FROM token_events)
         AND searches < 3
      ORDER BY cost DESC
      LIMIT 30
    `);
    return reply.send({ count: rows.length, rows });
  });
}
