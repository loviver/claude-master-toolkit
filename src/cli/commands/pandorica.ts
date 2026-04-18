import { readFileSync } from 'fs';
import { output, outputError } from '../../shared/output.js';
import {
  openPandoricaDb,
  save,
  search,
  context,
  recent,
  getById,
  deleteById,
  type PandoricaType,
  type PandoricaScope,
} from '../../shared/pandorica/db.js';

const VALID_TYPES: PandoricaType[] = [
  'bugfix', 'decision', 'architecture', 'discovery',
  'pattern', 'config', 'preference', 'session_summary',
];

function readContent(opts: { content?: string; file?: string; stdin?: boolean }): string {
  if (opts.content) return opts.content;
  if (opts.file) return readFileSync(opts.file, 'utf-8');
  if (opts.stdin) return readFileSync(0, 'utf-8');
  outputError('pandorica: provide --content, --file or --stdin');
}

export function saveCommand(opts: {
  title?: string;
  type?: string;
  content?: string;
  file?: string;
  stdin?: boolean;
  scope?: string;
  topicKey?: string;
  projectPath?: string;
  sessionId?: string;
}): void {
  if (!opts.title) outputError('save: --title required');
  if (!opts.type || !VALID_TYPES.includes(opts.type as PandoricaType)) {
    outputError(`save: --type must be one of ${VALID_TYPES.join('|')}`);
  }
  const content = readContent(opts);
  const db = openPandoricaDb();
  try {
    const row = save(db, {
      title: opts.title!,
      type: opts.type as PandoricaType,
      content,
      scope: opts.scope as PandoricaScope | undefined,
      topicKey: opts.topicKey,
      projectPath: opts.projectPath ?? process.cwd(),
      sessionId: opts.sessionId,
    });
    output({ saved: true, id: row.id, topic_key: row.topic_key });
  } finally {
    db.close();
    process.exit(0);
  }
}

export function searchCommand(query: string, opts: {
  limit?: string;
  type?: string;
  scope?: string;
  projectPath?: string;
}): void {
  const db = openPandoricaDb();
  try {
    const rows = search(db, {
      query,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      type: opts.type as PandoricaType | undefined,
      scope: opts.scope as PandoricaScope | undefined,
      projectPath: opts.projectPath,
    });
    output({
      count: rows.length,
      results: rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        topic_key: r.topic_key,
        updated_at: new Date(r.updated_at).toISOString(),
        preview: r.content.slice(0, 200),
      })),
    });
  } finally {
    db.close();
    process.exit(0);
  }
}

export function contextCommand(opts: { projectPath?: string; sessionId?: string; limit?: string }): void {
  const db = openPandoricaDb();
  try {
    const rows = context(db, {
      projectPath: opts.projectPath ?? process.cwd(),
      sessionId: opts.sessionId,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    });
    output({ count: rows.length, memories: rows });
  } finally {
    db.close();
    process.exit(0);
  }
}

export function recentCommand(opts: { limit?: string; all?: boolean }): void {
  const db = openPandoricaDb();
  try {
    const rows = recent(
      db,
      opts.all ? undefined : process.cwd(),
      opts.limit ? parseInt(opts.limit, 10) : 10,
    );
    output({
      count: rows.length,
      memories: rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        created_at: new Date(r.created_at).toISOString(),
      })),
    });
  } finally {
    db.close();
    process.exit(0);
  }
}

export function getCommand(id: string): void {
  const db = openPandoricaDb();
  try {
    const row = getById(db, id);
    if (!row) outputError(`pandorica: memory '${id}' not found`);
    output(row);
  } finally {
    db.close();
    process.exit(0);
  }
}

export function deleteCommand(id: string): void {
  const db = openPandoricaDb();
  try {
    const ok = deleteById(db, id);
    if (!ok) outputError(`pandorica: memory '${id}' not found`);
    output({ deleted: true, id });
  } finally {
    db.close();
    process.exit(0);
  }
}

export function summaryCommand(opts: {
  content?: string;
  file?: string;
  stdin?: boolean;
  sessionId?: string;
  projectPath?: string;
  title?: string;
}): void {
  const content = readContent(opts);
  const db = openPandoricaDb();
  try {
    const row = save(db, {
      title: opts.title ?? `Session summary ${new Date().toISOString()}`,
      type: 'session_summary',
      content,
      scope: 'project',
      topicKey: opts.sessionId ? `session/${opts.sessionId}` : undefined,
      projectPath: opts.projectPath ?? process.cwd(),
      sessionId: opts.sessionId,
    });
    output({ saved: true, id: row.id });
  } finally {
    db.close();
    process.exit(0);
  }
}
