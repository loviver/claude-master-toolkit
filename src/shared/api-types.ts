/**
 * Shared API DTOs — single source of truth for server responses and client consumers.
 * Do not import runtime code here (keep it pure types to be safe across cjs/esm builds).
 */

export type ModelKey = 'opus' | 'sonnet' | 'haiku' | 'unknown';
export type Phase = 'exploration' | 'implementation' | 'testing' | 'unknown';

// Strict known reasons plus `string & {}` escape hatch so autocomplete stays useful
// without forbidding unknown values coming from the API.
export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | (string & {});

export interface SessionGraphNodeDTO {
  id: string;
  turnIdx: number;
  model: string;
  modelKey: ModelKey;
  isSidechain: boolean;
  phase: Phase;
  tools: string[];
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitPct: number;
  stopReason: StopReason | null;
  costUsd: number;
  parentId: string | null;
  timestamp: number;
  // v7 enrichment (all optional — older rows may lack these)
  requestId?: string | null;
  slug?: string | null;
  messageId?: string | null;
  apiErrorStatus?: string | null;
  isApiError?: boolean;
  serviceTier?: string | null;
  speed?: string | null;
  cache1h?: number;
  cache5m?: number;
  webSearchCount?: number;
  webFetchCount?: number;
  iterationsCount?: number;
  durationMs?: number | null;
  permissionMode?: string | null;
  hasThinking?: boolean;
  hooksCount?: number;
  filesChangedCount?: number;
  // v9
  isMeta?: boolean;
  isCompactSummary?: boolean;
  toolsErrorCount?: number;
  cwd?: string | null;
  gitBranch?: string | null;
  // v10 — sub-agent lineage
  agentRole?: string | null;
}

export interface ToolCallStructuredDTO {
  toolUseId: string;
  toolName: string;
  orderIdx: number;
  inputJson: string | null;
  resultIsError: boolean | null;
  resultContent: string | null;
  resultStderr: string | null;
  resultStdout: string | null;
  resultExitCode: number | null;
}

export interface SessionGraphEdgeDTO {
  from: string;
  to: string;
  kind: 'chain' | 'sidechain';
}

export interface SessionGraphDTO {
  nodes: SessionGraphNodeDTO[];
  edges: SessionGraphEdgeDTO[];
}

export interface TurnToolCall {
  tool: string;
  inputPreview: string;
  resultPreview: string | null;
  toolUseId?: string;
  isError?: boolean;
  exitCode?: number | null;
  stderr?: string | null;
  interrupted?: boolean;
  isImage?: boolean;
}

export interface ThinkingBlockDTO {
  text: string;
  signature?: string;
}

export interface TurnHookDTO {
  name: string;
  event: string;
  exitCode?: number | null;
  durationMs?: number | null;
  stderr?: string | null;
}

export interface TurnContentDTO {
  eventId: number;
  role: 'user' | 'assistant';
  byteSize: number;
  assistantText: string | null;
  userPrompt: string | null;
  toolCalls: TurnToolCall[];
  thinkingBlocks?: ThinkingBlockDTO[];
  filesChanged?: string[];
  hooks?: TurnHookDTO[];
  permissionMode?: string | null;
  requestId?: string | null;
  slug?: string | null;
}

export interface TurnPairDTO {
  userEvent: {
    eventId: number;
    role: 'user';
    userPrompt: string | null;
    byteSize: number;
  } | null;
  assistantEvent: {
    eventId: number;
    role: 'assistant';
    assistantText: string | null;
    toolCalls: TurnToolCall[];
    agentRole: string | null;
    byteSize: number;
    thinkingBlocks?: ThinkingBlockDTO[];
    filesChanged?: string[];
    hooks?: TurnHookDTO[];
    permissionMode?: string | null;
    requestId?: string | null;
    slug?: string | null;
    apiErrorStatus?: string | null;
    isApiError?: boolean;
    // v9
    thinkingText?: string | null;
    cwd?: string | null;
    gitBranch?: string | null;
    promptId?: string | null;
    isMeta?: boolean;
    isCompactSummary?: boolean;
    parentEventId?: number | null;
    toolCallsStructured?: ToolCallStructuredDTO[];
  };
}

// ── Code graph (AST index rendered as a navigable graph) ──

/** Granularity of the code graph: directories, files, or individual symbols. */
export type CodeGraphLevel = 'module' | 'file' | 'symbol';
/**
 * `call` edges come from resolved call sites (deps), `ref` from type/const references,
 * `inherit` from extends/implements (subtype → supertype), and `dispatch` from a call through
 * a supertype to each override or implementation it may run (class hierarchy analysis).
 */
export type CodeGraphLinkType = 'call' | 'ref' | 'inherit' | 'dispatch';
/** Which edges a focus walk follows: `callers` = what a change would break, `deps` = what it builds on. */
export type CodeGraphDirection = 'callers' | 'deps' | 'both';

/** `focus` value that seeds the impact walk with every node the branch diff touches. */
export const DIFF_FOCUS = '@diff';

export interface CodeGraphNodeDTO {
  /** `dir` (module), `file` (file) or `file::symbol` (symbol). */
  id: string;
  label: string;
  /** `module` | `file` | the symbol kind (function, class, method, type, ...). */
  kind: string;
  /** Owning file; null for module nodes. */
  file: string | null;
  /** Cluster key: the first two directory segments, `.` for the repo root. */
  group: string;
  /** PageRank normalized so the top node of the level is 1. */
  rank: number;
  /** Symbols folded into this node (1 at symbol level). */
  size: number;
  exported: boolean;
  signature: string | null;
  startLine: number | null;
  endLine: number | null;
  /** Newest `indexed_files.indexed_at` behind this node (epoch ms, 0 if unknown). */
  indexedAt: number;
  /** Lines spanned by the symbols folded into this node. */
  loc: number;
  /** Distinct nodes at this level with an edge into this one (fan-in), counted before truncation. */
  callers: number;
  /** Commits touching this node's file(s) in the churn window; 0 when git history is unavailable. */
  churn: number;
}

export interface CodeGraphLinkDTO {
  source: string;
  target: string;
  type: CodeGraphLinkType;
  /** Number of symbol edges folded into this link. */
  weight: number;
}

export interface CodeGraphStatsDTO {
  totalNodes: number;
  totalLinks: number;
  /** Edges dropped because the indexer could not resolve their target. */
  unresolved: number;
  /** True when `limit` cut nodes off. */
  truncated: boolean;
  /** Nodes the `focus` matched (the node itself, or every node under a folder); absent without focus. */
  focusMatches?: number;
}

export interface CodeGraphDTO {
  project: string;
  level: CodeGraphLevel;
  revision: string;
  nodes: CodeGraphNodeDTO[];
  links: CodeGraphLinkDTO[];
  stats: CodeGraphStatsDTO;
}

export interface CodeGraphProjectDTO {
  projectPath: string;
  symbols: number;
  files: number;
  indexedAt: number;
}

export interface CodeGraphRevisionDTO {
  project: string;
  revision: string;
}

/** One symbol the diff touches, with its direct callers off the index. */
export interface CodeGraphChangeDTO {
  /** Qualified `file::symbol` id (the symbol-level node id). */
  id: string;
  file: string;
  symbol: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  /** Qualified ids of 1-hop callers that the diff does not touch (upstream impact). */
  callers: string[];
  /** Qualified ids of what this symbol uses (downstream), excluding itself. */
  deps: string[];
  /** Inclusive new-side `[start, end]` spans the diff touches, clipped to the symbol. */
  ranges: Array<[number, number]>;
  /** `+` lines inside the symbol. */
  added: number;
  /** `-` lines of the hunks that touch the symbol (a hunk crossing two symbols counts in both). */
  removed: number;
}

/** New-side line spans the diff touches in one file. */
export interface CodeGraphChangedFileDTO {
  file: string;
  /** Inclusive `[start, end]` line spans. */
  ranges: Array<[number, number]>;
  added: number;
  removed: number;
  /** Changed spans no indexed symbol covers: imports, top-level statements, comments. */
  outside: Array<[number, number]>;
}

/** Git status of a touched node: `added` when every file under it is new on the branch. */
export type CodeGraphChangeStatus = 'added' | 'modified';

/** The current branch's diff vs base, projected onto the node ids of one level. */
export interface CodeGraphRiskDTO {
  base: string;
  /** True when uncommitted edits are counted too (merge-base vs working tree). */
  worktree: boolean;
  tier: string;
  score: number;
  /** Nodes the diff touches. */
  touched: string[];
  /** Nodes that call touched code (blast radius), excluding touched ones. */
  blast: string[];
  /** Git status per touched node id. */
  status: Record<string, CodeGraphChangeStatus>;
  /** Touched symbols, most-called first. */
  changes: CodeGraphChangeDTO[];
  files: CodeGraphChangedFileDTO[];
}

/** One indexed file: the rows of the explorer tree. */
export interface CodeGraphFileDTO {
  file: string;
  symbols: number;
  indexedAt: number;
}

/** A symbol's span inside a source file, for the code viewer's outline. */
export interface CodeGraphOutlineDTO {
  /** Qualified `file::symbol` id. */
  id: string;
  symbol: string;
  kind: string;
  startLine: number;
  endLine: number;
}

/** Where a symbol lives: enough for the code viewer to open it. */
export interface CodeGraphSymbolRefDTO {
  /** Qualified `file::symbol` id. */
  id: string;
  symbol: string;
  kind: string;
  file: string;
  startLine: number;
  endLine: number;
}

/** A project-wide Go to Symbol hit. */
export interface CodeGraphSymbolHitDTO extends CodeGraphSymbolRefDTO {
  exported: boolean;
  signature: string | null;
}

/** A symbol on the other end of a call, with the call-site lines (in the calling symbol's file). */
export interface CodeGraphUsageDTO extends CodeGraphSymbolRefDTO {
  /** Sorted call-site lines; empty when the index recorded none. */
  lines: number[];
  /** Only reached through a supertype's method (an override that call may run), never called directly. */
  dispatch?: true;
}

/** One symbol and everything around it: the IDE's find usages, call hierarchy and type hierarchy. */
export interface CodeGraphSymbolDTO extends CodeGraphSymbolHitDTO {
  /** Symbols that call this one (directly or through a supertype it overrides). */
  callers: CodeGraphUsageDTO[];
  /** Symbols that name this one as a type or value without calling it. */
  referrers: CodeGraphSymbolRefDTO[];
  /** Symbols this one calls. */
  callees: CodeGraphUsageDTO[];
  /** Types and values this one names without calling them. */
  references: CodeGraphSymbolRefDTO[];
  /** Types this one extends or implements. */
  supertypes: CodeGraphSymbolRefDTO[];
  /** Types that extend or implement this one directly. */
  subtypes: CodeGraphSymbolRefDTO[];
  /** Direct members (`Owner.member`) declared in the same file. */
  members: CodeGraphSymbolRefDTO[];
}

/** One line of a review hunk; `old`/`new` are its number on each side, null where the line has none. */
export interface CodeGraphDiffLineDTO {
  kind: 'context' | 'add' | 'del';
  old: number | null;
  new: number | null;
  text: string;
}

export interface CodeGraphDiffHunkDTO {
  oldStart: number;
  newStart: number;
  /** The enclosing declaration git names after `@@` (may be empty). */
  section: string;
  lines: CodeGraphDiffLineDTO[];
}

/** One changed file's diff vs base, for the review viewer. */
export interface CodeGraphDiffDTO {
  file: string;
  base: string;
  /** True when uncommitted edits are counted too (merge-base vs working tree). */
  worktree: boolean;
  /** Prism grammar name, or null when the extension has none bundled. */
  language: string | null;
  status: 'added' | 'deleted' | 'modified';
  binary: boolean;
  hunks: CodeGraphDiffHunkDTO[];
}

/** An indexed file's text as it is on disk now (may be newer than the index). */
export interface CodeGraphSourceDTO {
  file: string;
  /** Prism grammar name, or null when the extension has none bundled. */
  language: string | null;
  content: string;
  outline: CodeGraphOutlineDTO[];
}
