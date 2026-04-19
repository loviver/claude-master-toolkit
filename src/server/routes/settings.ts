import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/db.js';
import { settings } from '../db/schema.js';

const ALLOWED_KEYS = new Set([
  'modelPref',
  'theme',
  'paginationSize',
  'cavemanMode',
  'notifications',
]);

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings', async (_req, reply) => {
    const db = getDb();
    const rows = db.select().from(settings).all();
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
    }
    return reply.send(out);
  });

  app.get('/settings/:key', async (req, reply) => {
    const { key } = req.params as { key: string };
    const db = getDb();
    const row = db.select().from(settings).where(eq(settings.key, key)).get();
    if (!row) return reply.code(404).send({ error: 'not found' });
    let value: unknown = row.value;
    try { value = JSON.parse(row.value); } catch { /* raw */ }
    return reply.send({ key, value });
  });

  app.put('/settings/:key', async (req, reply) => {
    const { key } = req.params as { key: string };
    if (!ALLOWED_KEYS.has(key)) {
      return reply.code(400).send({ error: `unknown key: ${key}` });
    }
    const body = req.body as { value?: unknown };
    if (body == null || body.value === undefined) {
      return reply.code(400).send({ error: 'body.value required' });
    }
    const db = getDb();
    const serialized = JSON.stringify(body.value);
    const now = Date.now();
    db.insert(settings)
      .values({ key, value: serialized, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: serialized, updatedAt: now },
      })
      .run();
    return reply.send({ key, value: body.value });
  });
}
