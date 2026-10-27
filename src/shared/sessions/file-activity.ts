/**
 * Which files an agent touched in a session, derived at read time from what every
 * agent leaves behind: tool calls (and Claude's file-history snapshots).
 *
 * Extractors are keyed by tool, not by agent: supporting a new agent means teaching
 * this table its file tools. No `node:path` here — the client imports it too.
 */

export type FileOp = 'read' | 'edit' | 'write';

export interface FileTouch {
  eventId: number;
  file: string;
  op: FileOp;
}

export interface FileTurnActivity {
  eventId: number;
  timestamp: number;
  costUsd: number;
  toolErrors: number;
  ops: FileOp[];
}

export interface FileActivity {
  /** Repo-relative, like the code index. */
  file: string;
  reads: number;
  /** Turns that changed the file (edit or write). */
  edits: number;
  turns: FileTurnActivity[];
}

export interface TurnMeta {
  timestamp: number;
  costUsd: number;
  toolErrors: number;
}

type Extractor = (input: Record<string, unknown>) => Array<{ file: string; op: FileOp }>;

const pathKey = (key: string, op: FileOp): Extractor => (input) =>
  typeof input[key] === 'string' && input[key] ? [{ file: input[key] as string, op }] : [];

const PATCH_HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;

/** Codex `apply_patch`: the patch text carries one header per file. */
const applyPatch: Extractor = (input) => {
  const text = [input.input, input.patch, ...(Array.isArray(input.command) ? input.command : [])]
    .filter((v): v is string => typeof v === 'string')
    .join('\n');
  return [...text.matchAll(PATCH_HEADER)].map((m) => ({ file: m[2].trim(), op: m[1] === 'Add' ? 'write' : 'edit' }));
};

const EXTRACTORS: Record<string, Extractor> = {
  Read: pathKey('file_path', 'read'),
  Edit: pathKey('file_path', 'edit'),
  MultiEdit: pathKey('file_path', 'edit'),
  Write: pathKey('file_path', 'write'),
  NotebookEdit: pathKey('notebook_path', 'edit'),
  apply_patch: applyPatch,
};

/** Tools whose `path` is a search root, not a file the agent looked at. */
const NOT_FILES = new Set(['Grep', 'Glob', 'LS', 'Bash']);

const GENERIC_KEYS = ['file_path', 'filePath', 'path'];

const generic: Extractor = (input) => {
  for (const key of GENERIC_KEYS) {
    const hit = pathKey(key, 'read')(input);
    if (hit.length) return hit;
  }
  return [];
};

export function touchesFromToolCall(eventId: number, toolName: string, inputJson: string | null): FileTouch[] {
  if (!inputJson || NOT_FILES.has(toolName)) return [];
  let input: unknown;
  try {
    input = JSON.parse(inputJson);
  } catch {
    // Inputs are stored truncated: a cut-off one names no file we can trust.
    return [];
  }
  if (!input || typeof input !== 'object') return [];
  const extract = EXTRACTORS[toolName] ?? generic;
  return extract(input as Record<string, unknown>).map((t) => ({ eventId, ...t }));
}

/** Claude's file-history snapshots: every tracked file there was changed by its turn. */
export function touchesFromSnapshots(rows: Array<{ eventId: number | null; filePath: string }>): FileTouch[] {
  return rows.flatMap((r) => (r.eventId === null ? [] : [{ eventId: r.eventId, file: r.filePath, op: 'edit' as const }]));
}

/** The path as the code index names it, or null when the file lives outside the project. */
export function toRepoRelative(projectPath: string, file: string): string | null {
  const root = projectPath.replace(/\/+$/, '');
  let rel: string;
  if (file.startsWith('/')) {
    if (!file.startsWith(`${root}/`)) return null;
    rel = file.slice(root.length + 1);
  } else {
    rel = file.replace(/^(\.\/)+/, '');
  }
  return rel && !rel.split('/').includes('..') ? rel : null;
}

const isChange = (op: FileOp) => op !== 'read';

/** Touches grouped per repo file, each turn once with its distinct ops; most edited files first. */
export function aggregateActivity(projectPath: string, touches: FileTouch[], meta: Map<number, TurnMeta>): FileActivity[] {
  const byFile = new Map<string, Map<number, Set<FileOp>>>();
  for (const t of touches) {
    const file = toRepoRelative(projectPath, t.file);
    if (!file) continue;
    const turns = byFile.get(file) ?? new Map<number, Set<FileOp>>();
    turns.set(t.eventId, (turns.get(t.eventId) ?? new Set()).add(t.op));
    byFile.set(file, turns);
  }
  return [...byFile].map(([file, turnOps]) => {
    const turns = [...turnOps]
      .map(([eventId, ops]) => {
        const m = meta.get(eventId);
        return { eventId, timestamp: m?.timestamp ?? 0, costUsd: m?.costUsd ?? 0, toolErrors: m?.toolErrors ?? 0, ops: [...ops] };
      })
      .sort((a, b) => a.timestamp - b.timestamp || a.eventId - b.eventId);
    return {
      file,
      reads: turns.filter((t) => t.ops.includes('read')).length,
      edits: turns.filter((t) => t.ops.some(isChange)).length,
      turns,
    };
  }).sort((a, b) => b.edits - a.edits || b.reads - a.reads || a.file.localeCompare(b.file));
}

/** Per-file weight for the graph's AI heatmap: a change says more than a look. */
export function aiHeat(files: FileActivity[]): Map<string, number> {
  return new Map(files.map((f) => [f.file, f.edits * 2 + f.reads]));
}
