import type Database from 'better-sqlite3';
import { save } from './crud.js';
import type {
  MemoryRow,
  SessionStartInput,
  SessionEndInput,
  SessionSummaryInput,
  PassiveInput,
  MergeInput,
} from './types.js';

// ── Session start marker ──

export function sessionStart(db: Database.Database, input: SessionStartInput): MemoryRow {
  return save(db, {
    title: `Session start ${input.sessionId}`,
    type: 'note',
    what: input.directory ?? null as unknown as string | undefined,
    topicKey: `session/start/${input.sessionId}`,
    sessionId: input.sessionId,
    projectPath: input.projectPath,
  });
}

// ── Session end marker ──

export function sessionEnd(db: Database.Database, input: SessionEndInput): MemoryRow {
  return save(db, {
    title: `Session end ${input.sessionId}`,
    type: 'note',
    what: input.summary,
    topicKey: `session/end/${input.sessionId}`,
    sessionId: input.sessionId,
    projectPath: input.projectPath,
  });
}

// ── Session summary memory ──

export function sessionSummary(db: Database.Database, input: SessionSummaryInput): MemoryRow {
  return save(db, {
    title: input.title ?? `Session summary ${new Date().toISOString()}`,
    type: 'session_summary',
    what: input.content,
    topicKey: `session/${input.sessionId}`,
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    scope: 'project',
  });
}

// ── Passive capture (ambient context) ──

export function passive(db: Database.Database, input: PassiveInput): MemoryRow {
  return save(db, {
    title: input.title ?? `Passive capture ${new Date().toISOString()}`,
    type: 'note',
    what: input.content,
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    description: input.source,
  });
}

// ── Merge project paths ──

export function merge(db: Database.Database, input: MergeInput): { moved: number } {
  const info = db.prepare(`UPDATE memories_v2 SET project_path = ? WHERE project_path = ?`)
    .run(input.to, input.from);
  return { moved: info.changes };
}
