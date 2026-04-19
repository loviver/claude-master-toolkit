import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/db.js';
import { sessions, tokenEvents, memoriesV2 as memories } from '../db/schema.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const db = getDb();

    const sessionCount = db.select({ count: sql<number>`count(*)` }).from(sessions).get();
    const eventCount = db.select({ count: sql<number>`count(*)` }).from(tokenEvents).get();
    const memoryCount = db.select({ count: sql<number>`count(*)` }).from(memories).get();

    return reply.send({
      status: 'ok',
      timestamp: Date.now(),
      counts: {
        sessions: sessionCount?.count ?? 0,
        tokenEvents: eventCount?.count ?? 0,
        memories: memoryCount?.count ?? 0,
      },
    });
  });
}
