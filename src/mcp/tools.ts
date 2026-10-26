import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handlers } from './handlers.js';

// workflow-tools pulls drizzle-orm (~250 ms of the MCP cold start) and only wf_* calls need it,
// so it is imported on first use. Needs `splitting: true` on the mcp entry (tsup.config.ts):
// without it the bundler hoists drizzle's import back to the top of dist/mcp.js.
type WfHandlers = typeof import('./workflow-tools.js').wfHandlers;
const loadWf = async (): Promise<WfHandlers> => (await import('./workflow-tools.js')).wfHandlers;

const FindingTypeSchema = z.enum(['bug', 'assumption', 'decision', 'deadend', 'pattern']);
const cwdParam = z.string().optional().describe('Absolute project path. Pass process.cwd() when invoking from a sub-agent to avoid CWD mismatch.');

export function registerTools(server: McpServer): void {
  server.registerTool(
    'ctk_understand',
    {
      annotations: { readOnlyHint: true },
      description:
        'Intent-based symbol intelligence. Returns signature + body + deps + callers in ONE call. ' +
        'Same-named definitions are ranked (exported first); `ambiguous`/`alternatives` flag collisions — pass `file` to pin one. ' +
        '`deps` lists in-project symbols only (language built-ins/globals like Intl are not indexed); lists are capped — see depsCount/callersCount. ' +
        'PREFER over Read for known symbols — 60-75% fewer tokens than reading full file.',
      inputSchema: {
        symbol: z.string().describe('Symbol name (class, function, method, type)'),
        file: z.string().optional().describe('Pin to one definition: exact project-relative path or path suffix. Use when the result reports ambiguous/multiple definitions.'),
        cwd: cwdParam,
      },
    },
    async (args) => handlers.ctk_understand(args),
  );

  server.registerTool(
    'ctk_find',
    {
      annotations: { readOnlyHint: true },
      description:
        'Search the AST-indexed symbol database. Fast lookup without reading files. ' +
        'Returns matches with file, range, signature, depsCount/callersCount, token estimate. ' +
        'For the lists use ctk_callers / ctk_deps / ctk_understand. `signatureTruncated: true` → use ctk_slice for the full text.',
      inputSchema: {
        name: z.string().describe('Symbol name (exact or suffix match for methods)'),
        kind: z.enum(['class', 'function', 'method', 'type', 'interface', 'const', 'enum']).optional(),
        exported: z.boolean().optional().describe('Filter to only exported symbols'),
        file: z.string().optional().describe('Pin to one definition: exact project-relative path or path suffix. Use when the result reports ambiguous/multiple definitions.'),
        cwd: cwdParam,
      },
    },
    async (args) => handlers.ctk_find(args),
  );

  server.registerTool(
    'ctk_deps',
    {
      annotations: { readOnlyHint: true },
      description:
        'List exports, call deps, non-call refs (types/consts) and file imports (incl. external packages). No file read required. ' +
        'FILE-LEVEL by default (union over every symbol, exports capped at 50); pass `symbol` to scope exports/deps/refs/imports to that one symbol. ' +
        'Deps cover in-project symbols only — language built-ins/globals (Intl, Array...) are not listed.',
      inputSchema: {
        file: z.string().describe('Relative file path from project root'),
        symbol: z.string().optional().describe('Scope the result to this symbol instead of the whole file'),
        cwd: cwdParam,
      },
    },
    async (args) => handlers.ctk_deps(args),
  );

  server.registerTool(
    'ctk_callers',
    {
      annotations: { readOnlyHint: true },
      description:
        'Reverse lookup from the index. `callers` = call edges (calls, `new`, JSX usage); `referrers` = non-call usage ' +
        '(type annotations, constant refs). When several definitions match, `definitions` groups them per definition; pass `file` to pin one. ' +
        "For types/interfaces/constants use include 'refs' or 'all' (default) — include 'calls' returns nothing for them. " +
        'Each entry is the calling SYMBOL (`line` = its definition); `callSites` lists the lines inside it where the call happens (absent on indexes built before v4).',
      inputSchema: {
        symbol: z.string().describe('Symbol name'),
        file: z.string().optional().describe('Pin to one definition: exact project-relative path or path suffix. Use when the result reports ambiguous/multiple definitions.'),
        include: z.enum(['calls', 'refs', 'all']).optional().describe("Which edges to return (default 'all')"),
        cwd: cwdParam,
      },
    },
    async (args) => handlers.ctk_callers(args),
  );

  server.registerTool(
    'ctk_map',
    {
      annotations: { readOnlyHint: true },
      description:
        'Repo map: the most structurally important symbols (PageRank over the call/reference graph) with signatures, ' +
        'grouped by file and cut to a token budget. Call FIRST when exploring an unfamiliar project or area, ' +
        'instead of reading files to get oriented. `focus` (files or symbol names) centers the map on that area.',
      inputSchema: {
        focus: z.array(z.string()).optional().describe('Files (path or suffix) or symbol names to center the map on'),
        budget: z.number().int().positive().optional().describe('Approximate token budget for the map (default 1024)'),
        cwd: cwdParam,
      },
    },
    async (args) => handlers.ctk_map(args),
  );

  server.registerTool(
    'ctk_slice',
    {
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
      description: 'Check if a brief has all required fields filled (task, constraints, success criteria).',
      inputSchema: {
        id: z.string(),
      },
    },
    async (args) => handlers.ctk_brief_validate(args),
  );

  server.registerTool(
    'ctk_risk',
    {
      annotations: { readOnlyHint: true },
      description:
        'ADVISORY ODD risk read of the current branch vs its base. Returns signals + score + tier ' +
        '(DIRECT|GUARDED|DELEGATE) + transparent rationale, measured off the AST index (blast radius, ' +
        'public API, spread, churn) — not guessed. Consult BEFORE deciding to work inline vs delegate.',
      inputSchema: {
        base: z.string().optional().describe('Base ref to diff against (default: origin HEAD or main)'),
        cwd: cwdParam,
      },
    },
    async (args) => handlers.ctk_risk(args),
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
      annotations: { readOnlyHint: true },
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
    type: z.enum(['task', 'agent', 'decision', 'skill', 'bash', 'read', 'edit', 'subflow', 'parallel']),
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
    async (args) => (await loadWf()).wf_create(args),
  );

  server.registerTool(
    'wf_list',
    {
      description: 'List all workflow plans, optionally filtered by project.',
      inputSchema: {
        project_path: z.string().optional(),
      },
    },
    async (args) => (await loadWf()).wf_list(args),
  );

  server.registerTool(
    'wf_get',
    {
      description: 'Get full plan definition by ID.',
      inputSchema: {
        plan_id: z.string(),
      },
    },
    async (args) => (await loadWf()).wf_get(args),
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
    async (args) => (await loadWf()).wf_update(args),
  );

  server.registerTool(
    'wf_generate',
    {
      description:
        'Generate a workflow plan with agents (explorer → implementer → reviewer). ' +
        'Takes a description and creates a 4-node plan ready to execute.',
      inputSchema: {
        description: z.string().describe('Plan description (e.g., "analyze and fix auth middleware")'),
        project_path: z.string().optional().describe('Defaults to process.cwd()'),
      },
    },
    async (args) => (await loadWf()).wf_generate(args),
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
    async (args) => (await loadWf()).wf_execute(args),
  );

  server.registerTool(
    'wf_status',
    {
      description: 'Get execution state and per-node timeline. Poll until state is completed/failed.',
      inputSchema: {
        execution_id: z.string(),
      },
    },
    async (args) => (await loadWf()).wf_status(args),
  );

  const mutationOpSchema = z.discriminatedUnion('op', [
    z.object({ op: z.literal('addNode'), after: z.string(), node: wfNodeSchema }),
    z.object({ op: z.literal('updateNode'), id: z.string(), patch: z.record(z.string(), z.unknown()) }),
    z.object({ op: z.literal('redirectEdge'), from: z.string(), to: z.string(), newTarget: z.string() }),
    z.object({ op: z.literal('removeNode'), id: z.string(), mode: z.enum(['skip', 'prune']) }),
    z.object({
      op: z.literal('addBranch'),
      from: z.string(),
      condition: z.string(),
      truePath: z.string(),
      falsePath: z.string(),
    }),
  ]);

  server.registerTool(
    'wf_mutate',
    {
      description:
        'Mutate a running workflow graph. Adds/updates/removes nodes or reroutes edges. ' +
        'Validates acyclicity, increments plan version, appends entry to mutationLog.',
      inputSchema: {
        execution_id: z.string().describe('Target running execution id'),
        op: mutationOpSchema,
        by_node_id: z.string().optional().describe('Id of the node that requested the mutation'),
      },
    },
    async (args) => (await loadWf()).wf_mutate(args as Parameters<WfHandlers['wf_mutate']>[0]),
  );

  server.registerTool(
    'wf_mutation_log',
    {
      description: 'Read the ordered mutation log for an execution (audit of agent-driven graph edits).',
      inputSchema: {
        execution_id: z.string(),
      },
    },
    async (args) => (await loadWf()).wf_mutation_log(args),
  );
}
