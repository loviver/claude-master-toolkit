import type { FastifyInstance } from 'fastify';
import { and, desc, eq, like, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { writeFileSync, existsSync } from 'fs';
import { getDb } from '../db/db.js';
import { memories } from '../db/schema.js';

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
        conditions.push(or(like(memories.title, s), like(memories.content, s), like(memories.topicKey, s)));
      }

      const rows = db
        .select()
        .from(memories)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(memories.updatedAt))
        .all();

      return reply.send(rows);
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
        lastAccessedAt: Date.now(),
      })
      .where(eq(memories.id, req.params.id))
      .run();

    return reply.send(memory);
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
        content: req.body.content,
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
      content: string;
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

    const content = `${frontmatter}\n\n${memory.content}`;

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
}
