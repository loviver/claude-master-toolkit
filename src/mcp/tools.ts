import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handlers } from './handlers.js';
import { wfHandlers } from './workflow-tools.js';

const FindingTypeSchema = z.enum(['bug', 'assumption', 'decision', 'deadend', 'pattern']);
const cwdParam = z.string().optional().describe('Absolute project path. Pass process.cwd() when invoking from a sub-agent to avoid CWD mismatch.');

export function registerTools(server: McpServer): void {
  server.registerTool(
    'ctk_understand',
    {
      description:
        'Intent-based symbol intelligence. Returns signature + body + deps + callers in ONE call. ' +
        'PREFER over Read for known symbols — 60-75% fewer tokens than reading full file.',
      inputSchema: {
        symbol: z.string().describe('Symbol name (class, function, method, type)'),
        cwd: cwdParam,
      },
    },
    async (args) => handlers.ctk_understand(args),
  );

  server.registerTool(
    'ctk_find',
    {
      description:
        'Search the AST-indexed symbol database. Fast lookup without reading files. ' +
        'Returns matches with file, range, signature, deps, callers, token estimate.',
      inputSchema: {
        name: z.string().describe('Symbol name (exact or suffix match for methods)'),
        kind: z.enum(['class', 'function', 'method', 'type', 'interface', 'const', 'enum']).optional(),
        exported: z.boolean().optional().describe('Filter to only exported symbols'),
        cwd: cwdParam,
      },
    },
    async (args) => handlers.ctk_find(args),
  );

  server.registerTool(
    'ctk_deps',
    {
      description: 'List exports and dependency symbols of a file. No file read required.',
      inputSchema: {
        file: z.string().describe('Relative file path from project root'),
        cwd: cwdParam,
      },
    },
    async (args) => handlers.ctk_deps(args),
  );

  server.registerTool(
    'ctk_callers',
    {
      description: 'Reverse lookup: which symbols call this one. Pre-computed from index.',
      inputSchema: {
        symbol: z.string().describe('Symbol name'),
        cwd: cwdParam,
      },
    },
    async (args) => handlers.ctk_callers(args),
  );

  server.registerTool(
    'ctk_slice',
    {
      description:
        'Raw extraction of symbol block from file (regex + brace counting). ' +
        'Fallback when ctk_understand cannot find the symbol in index (e.g., non-TS files).',
      inputSchema: {
        file: z.string(),
        symbol: z.string(),
      },
    },
    async (args) => handlers.ctk_slice(args),
  );

  server.registerTool(
    'ctk_record',
    {
      description:
        'Save a finding to the shared pool so other sub-agents can recall it. ' +
        'USE when you discover bugs, confirm assumptions, hit dead-ends, or establish patterns.',
      inputSchema: {
        type: FindingTypeSchema.describe('Finding category'),
        finding: z.string().describe('Short description of what was found'),
        symbol: z.string().optional(),
        file: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
        role: z.string().optional().describe('Agent role: explorer|implementer|reviewer'),
      },
    },
    async (args) => handlers.ctk_record(args),
  );

  server.registerTool(
    'ctk_recall',
    {
      description:
        'Query the findings pool BEFORE exploring a symbol. ' +
        'Check if another sub-agent already investigated this — avoids duplicate work.',
      inputSchema: {
        type: FindingTypeSchema.optional(),
        symbol: z.string().optional(),
        session: z.string().optional(),
        sinceMs: z.number().optional().describe('Only findings younger than N ms'),
      },
    },
    async (args) => handlers.ctk_recall(args),
  );

  server.registerTool(
    'ctk_brief_read',
    {
      description:
        'Read your task brief. The brief is the CONTRACT for this delegation — ' +
        'it defines known context, allowed actions, and success criteria. READ FIRST.',
      inputSchema: {
        id: z.string().describe('Brief ID (task slug)'),
      },
    },
    async (args) => handlers.ctk_brief_read(args),
  );

  server.registerTool(
    'ctk_brief_validate',
    {
      description: 'Check if a brief has all required fields filled (task, constraints, success criteria).',
      inputSchema: {
        id: z.string(),
      },
    },
    async (args) => handlers.ctk_brief_validate(args),
  );

  // ─── Pandorica: persistent memory vault ───────────────────────
  const PandoricaType = z.enum([
    'bugfix', 'decision', 'architecture', 'discovery',
    'pattern', 'config', 'preference', 'session_summary',
  ]);
  const PandoricaScope = z.enum(['project', 'personal']);

  server.registerTool(
    'pandorica_save',
    {
      description:
        'Pandorica — save a memory to the persistent vault. USE PROACTIVELY after: decisions, bugfixes, conventions, non-obvious discoveries, user preferences. Reuse topic_key to upsert an evolving topic.',
      inputSchema: {
        title: z.string().describe('Verb + what (e.g. "Fixed N+1 query in UserList")'),
        type: PandoricaType,
        content: z.string().describe('What / Why / Where / Learned'),
        scope: PandoricaScope.optional(),
        topic_key: z.string().optional().describe('Stable key for upsert (e.g. "architecture/auth-model")'),
        project_path: z.string().optional(),
        session_id: z.string().optional(),
      },
    },
    async (args) => handlers.pandorica_save(args),
  );

  server.registerTool(
    'pandorica_search',
    {
      description: 'Pandorica — search memories by keyword across title/content/topic_key.',
      inputSchema: {
        query: z.string(),
        limit: z.number().optional(),
        type: PandoricaType.optional(),
        scope: PandoricaScope.optional(),
        project_path: z.string().optional(),
      },
    },
    async (args) => handlers.pandorica_search(args),
  );

  server.registerTool(
    'pandorica_context',
    {
      description: 'Pandorica — recent memories for the current project/session. Call on session start to recover state.',
      inputSchema: {
        project_path: z.string().optional(),
        session_id: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async (args) => handlers.pandorica_context(args),
  );

  server.registerTool(
    'pandorica_get',
    {
      description: 'Pandorica — full untruncated content of a memory by id.',
      inputSchema: { id: z.string() },
    },
    async (args) => handlers.pandorica_get(args),
  );

  server.registerTool(
    'pandorica_session_summary',
    {
      description:
        'Pandorica — persist an end-of-session summary. Call before "done"/"listo" or after compaction. Upserts by session_id.',
      inputSchema: {
        content: z.string().describe('Markdown: Goal / Discoveries / Accomplished / Next Steps / Relevant Files'),
        session_id: z.string().optional(),
        project_path: z.string().optional(),
        title: z.string().optional(),
      },
    },
    async (args) => handlers.pandorica_session_summary(args),
  );

  server.registerTool(
    'pandorica_recent',
    {
      description: 'Pandorica — last N memories by creation time, optionally scoped to a project.',
      inputSchema: {
        project_path: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async (args) => handlers.pandorica_recent(args),
  );

  // ── Workflow Plans ──

  const wfNodeSchema = z.object({
    id: z.string(),
    type: z.enum(['task', 'agent', 'decision']),
    label: z.string(),
    description: z.string().optional(),
    config: z.record(z.string(), z.unknown()),
    edges: z.array(z.object({
      target: z.string(),
      condition: z.string().optional(),
    })),
    retries: z.number().optional(),
    timeout: z.number().optional(),
  });

  const wfDefinitionSchema = z.object({
    nodes: z.array(wfNodeSchema),
    entrypoint: z.string(),
  });

  server.registerTool(
    'wf_create',
    {
      description:
        'Create a workflow plan. Plans define a DAG of task/agent/decision nodes. ' +
        'Execute with wf_execute. View in dashboard /workflows.',
      inputSchema: {
        name: z.string().describe('Plan name'),
        definition: wfDefinitionSchema,
        description: z.string().optional(),
        project_path: z.string().optional().describe('Defaults to process.cwd()'),
      },
    },
    (args) => wfHandlers.wf_create(args),
  );

  server.registerTool(
    'wf_list',
    {
      description: 'List all workflow plans, optionally filtered by project.',
      inputSchema: {
        project_path: z.string().optional(),
      },
    },
    (args) => wfHandlers.wf_list(args),
  );

  server.registerTool(
    'wf_get',
    {
      description: 'Get full plan definition by ID.',
      inputSchema: {
        plan_id: z.string(),
      },
    },
    (args) => wfHandlers.wf_get(args),
  );

  server.registerTool(
    'wf_update',
    {
      description: 'Update a workflow plan (name, description, or full definition).',
      inputSchema: {
        plan_id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        definition: wfDefinitionSchema.optional(),
      },
    },
    (args) => wfHandlers.wf_update(args),
  );

  server.registerTool(
    'wf_execute',
    {
      description:
        'Execute a workflow plan. Returns executionId immediately — poll wf_status for progress. ' +
        'Agent nodes are queued; task nodes run their command.',
      inputSchema: {
        plan_id: z.string(),
      },
    },
    async (args) => wfHandlers.wf_execute(args),
  );

  server.registerTool(
    'wf_status',
    {
      description: 'Get execution state and per-node timeline. Poll until state is completed/failed.',
      inputSchema: {
        execution_id: z.string(),
      },
    },
    (args) => wfHandlers.wf_status(args),
  );
}
