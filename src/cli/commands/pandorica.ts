// Legacy `ctk pandorica` CLI — thin wrapper over Pandorica v2 (`mem_*`).
// DEPRECATED: prefer `ctk mem <subcmd>`. Kept for backward-compat.
import { readFileSync } from 'fs';
import { output, outputError } from '../../shared/output.js';
import {
  openMemDb,
  save,
  recall,
  context as v2Context,
  trace,
  getById,
  deleteById,
  sessionSummary,
  type MemoryType,
  type MemoryScope,
} from '../../shared/memories/v2.js';
import type { ContentSource } from '../types/mem-opts.js';
import type {
  LegacyPandoricaType,
  PandoricaSaveOpts,
  PandoricaSearchOpts,
  PandoricaContextOpts,
  PandoricaRecentOpts,
  PandoricaSummaryOpts,
} from '../types/pandorica-opts.js';

const LEGACY_TYPES: LegacyPandoricaType[] = [
  'bugfix', 'decision', 'architecture', 'discovery',
  'pattern', 'config', 'preference', 'session_summary',
];

function mapType(t: LegacyPandoricaType): MemoryType {
  if (t === 'discovery') return 'note';
  if (t === 'config') return 'reference';
  return t as MemoryType;
}

function warnDeprecated(sub: string): void {
  // Stderr-only. Does not affect --json output on stdout.
  console.warn(`[ctk] DEPRECATED: 'ctk pandorica ${sub}' — use 'ctk mem ${sub}' instead.`);
}

function readContent(opts: ContentSource): string {
  if (opts.content) return opts.content;
  if (opts.file) return readFileSync(opts.file, 'utf-8');
  if (opts.stdin) return readFileSync(0, 'utf-8');
  outputError('pandorica: provide --content, --file or --stdin');
  return '';
}

function withDb<T>(fn: (db: ReturnType<typeof openMemDb>) => T): T {
  const db = openMemDb();
  try { return fn(db); } finally { db.close(); }
}

export function saveCommand(opts: PandoricaSaveOpts): void {
  warnDeprecated('save');
  if (!opts.title) outputError('save: --title required');
  if (!opts.type || !LEGACY_TYPES.includes(opts.type as LegacyPandoricaType)) {
    outputError(`save: --type must be one of ${LEGACY_TYPES.join('|')}`);
  }
  const content = readContent(opts);
  withDb((db) => {
    const row = save(db, {
      title: opts.title!,
      type: mapType(opts.type as LegacyPandoricaType),
      what: content,
      scope: opts.scope as MemoryScope | undefined,
      topicKey: opts.topicKey,
      projectPath: opts.projectPath ?? process.cwd(),
      sessionId: opts.sessionId,
    });
    output({ saved: true, id: row.id, topic_key: row.topic_key });
  });
  process.exit(0);
}

export function searchCommand(query: string, opts: PandoricaSearchOpts): void {
  warnDeprecated('search');
  withDb((db) => {
    const legacy = opts.type as LegacyPandoricaType | undefined;
    const type: MemoryType | undefined = legacy ? mapType(legacy) : undefined;
    const rows = recall(db, {
      query,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      type,
      scope: opts.scope as MemoryScope | undefined,
      projectPath: opts.projectPath,
    });
    output({
      count: rows.length,
      results: rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        topic_key: r.topic_key,
        updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        preview: (r.what ?? '').slice(0, 200),
      })),
    });
  });
  process.exit(0);
}

export function contextCommand(opts: PandoricaContextOpts): void {
  warnDeprecated('context');
  withDb((db) => {
    const rows = v2Context(db, {
      projectPath: opts.projectPath ?? process.cwd(),
      sessionId: opts.sessionId,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    });
    output({ count: rows.length, memories: rows });
  });
  process.exit(0);
}

export function recentCommand(opts: PandoricaRecentOpts): void {
  warnDeprecated('recent');
  withDb((db) => {
    const rows = trace(db, {
      projectPath: opts.all ? undefined : process.cwd(),
      limit: opts.limit ? parseInt(opts.limit, 10) : 10,
    });
    output({
      count: rows.length,
      memories: rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        created_at: new Date(r.created_at).toISOString(),
      })),
    });
  });
  process.exit(0);
}

export function getCommand(id: string): void {
  warnDeprecated('get');
  withDb((db) => {
    const row = getById(db, id);
    if (!row) outputError(`pandorica: memory '${id}' not found`);
    output(row);
  });
  process.exit(0);
}

export function deleteCommand(id: string): void {
  warnDeprecated('delete');
  withDb((db) => {
    const ok = deleteById(db, id);
    if (!ok) outputError(`pandorica: memory '${id}' not found`);
    output({ deleted: true, id });
  });
  process.exit(0);
}

export function summaryCommand(opts: PandoricaSummaryOpts): void {
  warnDeprecated('summary');
  const content = readContent(opts);
  const sid = opts.sessionId ?? `cli-${Date.now()}`;
  withDb((db) => {
    const row = sessionSummary(db, {
      sessionId: sid,
      content,
      title: opts.title,
      projectPath: opts.projectPath ?? process.cwd(),
    });
    output({ saved: true, id: row.id });
  });
  process.exit(0);
}
