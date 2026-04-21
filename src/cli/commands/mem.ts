import { readFileSync, writeFileSync } from 'fs';
import { output, outputError } from '../../shared/output.js';
import {
  openMemDb,
  save,
  recall,
  context,
  trace,
  getById,
  deleteById,
  sessionSummary,
  stats,
  exportVault,
  importVault,
  type MemoryType,
} from '../../shared/memories/v2.js';
import type {
  ContentSource,
  MemSaveOpts,
  MemRecallOpts,
  MemContextOpts,
  MemTraceOpts,
  MemSummaryOpts,
  MemStatsOpts,
  MemExportOpts,
  MemImportOpts,
} from '../types/mem-opts.js';

const VALID_TYPES: MemoryType[] = [
  'decision', 'bugfix', 'architecture', 'pattern',
  'preference', 'reference', 'note', 'session_summary',
];

function readContent(opts: ContentSource): string {
  if (opts.content) return opts.content;
  if (opts.file) return readFileSync(opts.file, 'utf-8');
  if (opts.stdin) return readFileSync(0, 'utf-8');
  outputError('mem: provide --content, --file or --stdin');
  return '';
}

function withDb<T>(fn: (db: ReturnType<typeof openMemDb>) => T): T {
  const db = openMemDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function memSaveCommand(opts: MemSaveOpts): void {
  if (!opts.title) outputError('mem save: --title required');
  const type = (opts.type ?? 'note') as MemoryType;
  if (!VALID_TYPES.includes(type)) {
    outputError(`mem save: --type must be one of ${VALID_TYPES.join('|')}`);
  }
  const what = opts.what ?? (opts.content || opts.file || opts.stdin ? readContent(opts) : undefined);

  withDb((db) => {
    const row = save(db, {
      title: opts.title!,
      type,
      what,
      why: opts.why,
      where: opts.where,
      learned: opts.learned,
      topicKey: opts.topicKey,
      scope: opts.scope,
      projectPath: opts.projectPath ?? process.cwd(),
      sessionId: opts.sessionId,
    });
    output({ saved: true, id: row.id, topic_key: row.topic_key });
  });
  process.exit(0);
}

export function memRecallCommand(query: string, opts: MemRecallOpts): void {
  withDb((db) => {
    const rows = recall(db, {
      query,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      type: opts.type,
      scope: opts.scope,
      projectPath: opts.projectPath,
    });
    output({
      count: rows.length,
      results: rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        topic_key: r.topic_key,
        rank: r.rank,
        preview: (r.what ?? '').slice(0, 200),
      })),
    });
  });
  process.exit(0);
}

export function memContextCommand(opts: MemContextOpts): void {
  withDb((db) => {
    const rows = context(db, {
      projectPath: opts.projectPath ?? process.cwd(),
      sessionId: opts.sessionId,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    });
    output({ count: rows.length, memories: rows });
  });
  process.exit(0);
}

export function memTraceCommand(opts: MemTraceOpts): void {
  withDb((db) => {
    const rows = trace(db, {
      projectPath: opts.projectPath,
      sessionId: opts.sessionId,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    });
    output({ count: rows.length, memories: rows });
  });
  process.exit(0);
}

export function memGetCommand(id: string): void {
  withDb((db) => {
    const row = getById(db, id);
    if (!row) outputError(`mem: memory '${id}' not found`);
    output(row);
  });
  process.exit(0);
}

export function memDeleteCommand(id: string): void {
  withDb((db) => {
    const ok = deleteById(db, id);
    if (!ok) outputError(`mem: memory '${id}' not found`);
    output({ deleted: true, id });
  });
  process.exit(0);
}

export function memSummaryCommand(opts: MemSummaryOpts): void {
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

export function memStatsCommand(opts: MemStatsOpts): void {
  withDb((db) => {
    const out = stats(db, {
      projectPath: opts.all ? undefined : (opts.projectPath ?? process.cwd()),
    });
    output(out);
  });
  process.exit(0);
}

export function memExportCommand(opts: MemExportOpts): void {
  withDb((db) => {
    const dump = exportVault(db, {
      projectPath: opts.all ? undefined : (opts.projectPath ?? process.cwd()),
    });
    const json = JSON.stringify(dump, null, 2);
    if (opts.out) {
      writeFileSync(opts.out, json, 'utf-8');
      output({ exported: true, count: dump.memories.length, file: opts.out });
    } else {
      console.log(json);
    }
  });
  process.exit(0);
}

export function memImportCommand(opts: MemImportOpts): void {
  const raw = opts.file ? readFileSync(opts.file, 'utf-8') : (opts.stdin ? readFileSync(0, 'utf-8') : '');
  if (!raw) outputError('mem import: provide --file or --stdin');
  const dump = JSON.parse(raw);
  withDb((db) => {
    const result = importVault(db, dump);
    output(result);
  });
  process.exit(0);
}
