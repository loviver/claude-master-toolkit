import {
  openMemDb,
  save,
  update,
  deleteById,
  mark,
  recall,
  context,
  trace,
  getById,
  sessionStart,
  sessionEnd,
  sessionSummary,
  passive,
  merge,
  suggest,
  stats,
  exportVault,
  importVault,
  type MemoryType,
  type MemoryScope,
  type VaultDump,
} from '../shared/memories/v2.js';

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(msg: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }],
    isError: true as const,
  };
}

function withDb<T>(fn: (db: ReturnType<typeof openMemDb>) => T): T {
  const db = openMemDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const PROJECT_PATH = (p?: string) =>
  p ?? process.env['CTK_PROJECT_PATH'] ?? process.cwd();

interface SaveArgs {
  title: string;
  type?: MemoryType;
  what?: string;
  why?: string;
  where?: string;
  learned?: string;
  topic_key?: string;
  scope?: MemoryScope;
  project_path?: string;
  session_id?: string;
  model?: string;
  phase?: string;
  tokens_input?: number;
  tokens_output?: number;
  cache_hit_pct?: number;
  cost_usd?: number;
  description?: string;
  file_path?: string;
}

export const memHandlers = {
  mem_save(args: SaveArgs) {
    return withDb((db) => {
      const row = save(db, {
        title: args.title,
        type: args.type,
        what: args.what,
        why: args.why,
        where: args.where,
        learned: args.learned,
        topicKey: args.topic_key,
        scope: args.scope,
        projectPath: args.project_path ?? PROJECT_PATH(),
        sessionId: args.session_id ?? process.env['CLAUDE_SESSION_ID'],
        model: args.model,
        phase: args.phase,
        tokensInput: args.tokens_input,
        tokensOutput: args.tokens_output,
        cacheHitPct: args.cache_hit_pct,
        costUsd: args.cost_usd,
        description: args.description,
        filePath: args.file_path,
      });
      return jsonResult({
        saved: true,
        id: row.id,
        topic_key: row.topic_key,
        updated: row.created_at !== row.updated_at,
      });
    });
  },

  mem_update(args: { id: string } & Partial<SaveArgs>) {
    return withDb((db) => {
      const row = update(db, args.id, {
        title: args.title,
        type: args.type,
        what: args.what,
        why: args.why,
        where: args.where,
        learned: args.learned,
        topicKey: args.topic_key,
        scope: args.scope,
        projectPath: args.project_path,
        description: args.description,
        filePath: args.file_path,
        model: args.model,
        phase: args.phase,
        tokensInput: args.tokens_input,
        tokensOutput: args.tokens_output,
        cacheHitPct: args.cache_hit_pct,
        costUsd: args.cost_usd,
      });
      if (!row) return errorResult(`mem_update: memory '${args.id}' not found`);
      return jsonResult(row);
    });
  },

  mem_delete(args: { id: string }) {
    return withDb((db) => jsonResult({ deleted: deleteById(db, args.id) }));
  },

  mem_mark(args: { id: string; topic_key: string }) {
    return withDb((db) => {
      const row = mark(db, args.id, args.topic_key);
      if (!row) return errorResult(`mem_mark: memory '${args.id}' not found`);
      return jsonResult(row);
    });
  },

  mem_recall(args: {
    query: string;
    limit?: number;
    type?: MemoryType;
    scope?: MemoryScope;
    project_path?: string;
    session_id?: string;
  }) {
    return withDb((db) => {
      const results = recall(db, {
        query: args.query,
        limit: args.limit,
        type: args.type,
        scope: args.scope,
        projectPath: args.project_path,
        sessionId: args.session_id,
      });
      return jsonResult({
        count: results.length,
        results: results.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          topic_key: r.topic_key,
          rank: r.rank,
          updated_at: r.updated_at,
          preview: (r.what ?? '').slice(0, 240),
        })),
      });
    });
  },

  mem_context(args: { project_path?: string; session_id?: string; limit?: number }) {
    return withDb((db) => {
      const rows = context(db, {
        projectPath: args.project_path ?? PROJECT_PATH(),
        sessionId: args.session_id,
        limit: args.limit,
      });
      return jsonResult({ count: rows.length, memories: rows });
    });
  },

  mem_trace(args: { project_path?: string; session_id?: string; limit?: number }) {
    return withDb((db) => {
      const rows = trace(db, {
        projectPath: args.project_path,
        sessionId: args.session_id,
        limit: args.limit,
      });
      return jsonResult({ count: rows.length, memories: rows });
    });
  },

  mem_get(args: { id: string }) {
    return withDb((db) => {
      const row = getById(db, args.id);
      if (!row) return errorResult(`mem_get: memory '${args.id}' not found`);
      return jsonResult(row);
    });
  },

  mem_session(args: {
    sub: 'start' | 'end' | 'summary';
    session_id: string;
    project_path?: string;
    directory?: string;
    content?: string;
    summary?: string;
    title?: string;
  }) {
    return withDb((db) => {
      if (args.sub === 'start') {
        const row = sessionStart(db, {
          sessionId: args.session_id,
          projectPath: args.project_path ?? PROJECT_PATH(),
          directory: args.directory,
        });
        return jsonResult({ saved: true, id: row.id, topic_key: row.topic_key });
      }
      if (args.sub === 'end') {
        const row = sessionEnd(db, {
          sessionId: args.session_id,
          summary: args.summary,
          projectPath: args.project_path ?? PROJECT_PATH(),
        });
        return jsonResult({ saved: true, id: row.id, topic_key: row.topic_key });
      }
      if (args.sub === 'summary') {
        const row = sessionSummary(db, {
          sessionId: args.session_id,
          content: args.content ?? '',
          title: args.title,
          projectPath: args.project_path ?? PROJECT_PATH(),
        });
        return jsonResult({ saved: true, id: row.id, topic_key: row.topic_key });
      }
      return errorResult(`mem_session: unknown sub '${args.sub}'`);
    });
  },

  mem_passive(args: {
    content: string;
    session_id?: string;
    project_path?: string;
    source?: string;
    title?: string;
  }) {
    return withDb((db) => {
      const row = passive(db, {
        content: args.content,
        sessionId: args.session_id ?? process.env['CLAUDE_SESSION_ID'],
        projectPath: args.project_path ?? PROJECT_PATH(),
        source: args.source,
        title: args.title,
      });
      return jsonResult({ saved: true, id: row.id });
    });
  },

  mem_merge(args: { from: string; to: string }) {
    return withDb((db) => jsonResult(merge(db, { from: args.from, to: args.to })));
  },

  mem_suggest(args: { title: string; content?: string; type?: MemoryType; limit?: number }) {
    return withDb((db) => {
      const hints = suggest(db, {
        title: args.title,
        content: args.content,
        type: args.type,
        limit: args.limit,
      });
      return jsonResult({
        hints: hints.map((h) => ({ topic_key: h.topicKey, score: h.score })),
      });
    });
  },

  mem_stats(args: { project_path?: string }) {
    return withDb((db) => jsonResult(stats(db, { projectPath: args.project_path })));
  },

  mem_export(args: { project_path?: string }) {
    return withDb((db) => jsonResult(exportVault(db, { projectPath: args.project_path })));
  },

  mem_import(args: { dump: VaultDump }) {
    return withDb((db) => jsonResult(importVault(db, args.dump)));
  },
};
