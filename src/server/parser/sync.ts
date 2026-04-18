import { statSync, existsSync } from 'fs';
import { basename, dirname } from 'path';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/db.js';
import { sessions, tokenEvents, turnContent, syncState, turnHooks, turnFileChanges } from '../db/schema.js';
import {
  parseJsonlFile,
  extractTokenEvents,
  extractEnrichedTokenEvents,
  extractSessionMeta,
  extractTurnDurations,
  extractHookAttachments,
  extractFileHistorySnapshots,
  listProjectDirs,
  listSessionFiles,
} from '../../shared/jsonl-parser.js';
import { computeCost } from '../../shared/pricing.js';
import type { TokenUsage } from '../../shared/types.js';

export async function syncFile(filePath: string): Promise<void> {
  if (!existsSync(filePath)) return;

  const db = getDb();
  const stat = statSync(filePath);

  const existing = db.select().from(syncState).where(eq(syncState.filePath, filePath)).get();
  if (existing?.lastModified === stat.mtimeMs) return;

  const allEvents = await parseJsonlFile(filePath);
  const meta = extractSessionMeta(allEvents);
  const tokenEvts = extractTokenEvents(allEvents);

  const totalTokens = tokenEvts.reduce<TokenUsage>(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.usage.inputTokens,
      outputTokens: acc.outputTokens + e.usage.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + e.usage.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + e.usage.cacheCreationTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );

  const totalCost = tokenEvts.reduce(
    (acc, e) => acc + computeCost(e.model, e.usage),
    0,
  );

  const projectPath = meta.cwd || basename(dirname(filePath));

  db.insert(sessions)
    .values({
      id: meta.sessionId,
      projectPath,
      startedAt: new Date(meta.startedAt).getTime(),
      lastActiveAt: new Date(meta.lastActiveAt).getTime(),
      primaryModel: meta.primaryModel,
      gitBranch: meta.gitBranch,
      version: meta.version,
      turnCount: meta.turnCount,
      totalInputTokens: totalTokens.inputTokens,
      totalOutputTokens: totalTokens.outputTokens,
      totalCacheReadTokens: totalTokens.cacheReadTokens,
      totalCacheCreationTokens: totalTokens.cacheCreationTokens,
      totalCostUsd: totalCost,
      jsonlFile: filePath,
    })
    .onConflictDoUpdate({
      target: sessions.id,
      set: {
        lastActiveAt: new Date(meta.lastActiveAt).getTime(),
        primaryModel: meta.primaryModel,
        turnCount: meta.turnCount,
        totalInputTokens: totalTokens.inputTokens,
        totalOutputTokens: totalTokens.outputTokens,
        totalCacheReadTokens: totalTokens.cacheReadTokens,
        totalCacheCreationTokens: totalTokens.cacheCreationTokens,
        totalCostUsd: totalCost,
      },
    })
    .run();

  db.delete(tokenEvents).where(eq(tokenEvents.sessionId, meta.sessionId)).run();
  db.delete(turnHooks).where(eq(turnHooks.sessionId, meta.sessionId)).run();
  db.delete(turnFileChanges).where(eq(turnFileChanges.sessionId, meta.sessionId)).run();

  const enrichedEvts = extractEnrichedTokenEvents(allEvents);
  const durationByUuid = extractTurnDurations(allEvents);
  const hooks = extractHookAttachments(allEvents);
  const snapshots = extractFileHistorySnapshots(allEvents);

  const uuidToEventId = new Map<string, number>();
  const messageIdToEventId = new Map<string, number>();

  for (const evt of enrichedEvts) {
    const cost = computeCost(evt.model, evt.usage);
    const agentRole = extractAgentRole(evt.content ?? null);
    const durationMs = evt.uuid ? durationByUuid.get(evt.uuid) ?? null : null;
    const inserted = db.insert(tokenEvents)
      .values({
        sessionId: meta.sessionId,
        timestamp: new Date(evt.timestamp).getTime(),
        model: evt.model,
        inputTokens: evt.usage.inputTokens,
        outputTokens: evt.usage.outputTokens,
        cacheReadTokens: evt.usage.cacheReadTokens,
        cacheCreationTokens: evt.usage.cacheCreationTokens,
        costUsd: cost,
        toolsUsed: JSON.stringify(evt.toolsUsed),
        stopReason: evt.stopReason,
        isSidechain: evt.isSidechain,
        parentUuid: evt.parentUuid,
        semanticPhase: evt.semanticPhase,
        agentRole,
        uuid: evt.uuid,
        messageId: evt.messageId,
        requestId: evt.requestId,
        slug: evt.slug,
        apiErrorStatus: evt.apiErrorStatus,
        isApiError: !!evt.isApiError,
        serviceTier: evt.serviceTier,
        speed: evt.speed,
        cache1hTokens: evt.cache1h ?? 0,
        cache5mTokens: evt.cache5m ?? 0,
        webSearchCount: evt.webSearchCount ?? 0,
        webFetchCount: evt.webFetchCount ?? 0,
        iterationsCount: evt.iterationsCount ?? 0,
        durationMs,
        permissionMode: evt.permissionMode,
        hasThinking: !!evt.hasThinking,
      })
      .returning({ id: tokenEvents.id })
      .get();

    if (inserted) {
      if (evt.uuid) uuidToEventId.set(evt.uuid, inserted.id);
      if (evt.messageId) messageIdToEventId.set(evt.messageId, inserted.id);
      if (evt.content) {
        db.insert(turnContent)
          .values({
            eventId: inserted.id,
            role: 'assistant',
            content: evt.content,
            contentHash: evt.contentHash!,
            byteSize: Buffer.byteLength(evt.content, 'utf-8'),
          })
          .run();
      }
    }
  }

  // Hooks: resolve event_id via parentUuid → assistant uuid → event_id. Fallback: null.
  for (const h of hooks) {
    const evId = h.parentUuid ? uuidToEventId.get(h.parentUuid) ?? null : null;
    db.insert(turnHooks).values({
      sessionId: meta.sessionId,
      eventId: evId,
      hookName: h.hookName,
      hookEvent: h.hookEvent,
      exitCode: h.exitCode ?? null,
      durationMs: h.durationMs ?? null,
      stdout: h.stdout ?? null,
      stderr: h.stderr ?? null,
      command: h.command ?? null,
      timestamp: new Date(h.timestamp).getTime(),
    }).run();
  }

  // Persist user events (prompts + tool_results) linked to an assistant turn.
  // - tool_result user events: sourceToolAssistantUUID → that assistant's eventId, role='tool_result'
  // - prompt user events (no tool result): linked to the next assistant turn, role='user'
  const crypto = await import('crypto');
  for (let i = 0; i < allEvents.length; i++) {
    const ev = allEvents[i];
    if (ev.type !== 'user' || !ev.message) continue;
    const raw = JSON.stringify(ev.message.content);
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const size = Buffer.byteLength(raw, 'utf-8');

    if (ev.sourceToolAssistantUUID) {
      const evId = uuidToEventId.get(ev.sourceToolAssistantUUID);
      if (evId) {
        db.insert(turnContent).values({
          eventId: evId,
          role: 'tool_result',
          content: raw,
          contentHash: hash,
          byteSize: size,
        }).run();
      }
      continue;
    }

    // Find next assistant event (by array position) that made it into DB.
    for (let j = i + 1; j < allEvents.length; j++) {
      const nxt = allEvents[j];
      if (nxt.type !== 'assistant') continue;
      const evId = nxt.uuid ? uuidToEventId.get(nxt.uuid) : undefined;
      if (evId) {
        db.insert(turnContent).values({
          eventId: evId,
          role: 'user',
          content: raw,
          contentHash: hash,
          byteSize: size,
        }).run();
      }
      break;
    }
  }

  // File history snapshots: messageId matches assistant event uuid.
  for (const s of snapshots) {
    const evId = uuidToEventId.get(s.messageId) ?? null;
    const ts = s.timestamp ? new Date(s.timestamp).getTime() : null;
    for (const file of s.files) {
      db.insert(turnFileChanges).values({
        sessionId: meta.sessionId,
        eventId: evId,
        messageId: s.messageId,
        filePath: file,
        isSnapshotUpdate: s.isSnapshotUpdate,
        timestamp: ts,
      }).run();
    }
  }

  db.insert(syncState)
    .values({ filePath, lastByteOffset: 0, lastModified: stat.mtimeMs })
    .onConflictDoUpdate({
      target: syncState.filePath,
      set: { lastByteOffset: 0, lastModified: stat.mtimeMs },
    })
    .run();
}

/**
 * Full sync: scan all project directories and sync all JSONL files.
 */
function extractAgentRole(content: string | null): string | null {
  if (!content) return null;
  const agentPatterns = [
    /Agent\s*\(\s*{[^}]*type\s*:\s*['"]([^'"]+)['"]/i,
    /@sub-agent\s+(\w+)/i,
    /Skill\s*\(\s*{[^}]*skill\s*:\s*['"]([^'"]+)['"]/i,
  ];
  for (const pattern of agentPatterns) {
    const match = content.match(pattern);
    if (match) {
      const role = match[1].toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (['explorer', 'implementer', 'reviewer', 'orchestrator', 'general-purpose', 'plan'].includes(role)) {
        return role;
      }
    }
  }
  return null;
}

/**
 * Full sync: scan all project directories and sync all JSONL files.
 */
export async function syncAll(): Promise<{ files: number; sessions: number }> {
  const projectDirs = listProjectDirs();
  let fileCount = 0;

  for (const dir of projectDirs) {
    const files = listSessionFiles(dir);
    for (const file of files) {
      await syncFile(file);
      fileCount++;
    }
  }

  const db = getDb();
  const sessionCount = db.select().from(sessions).all().length;

  return { files: fileCount, sessions: sessionCount };
}
