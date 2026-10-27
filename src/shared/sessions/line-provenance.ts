/**
 * Which agent turn wrote a block of `+` lines of a diff: the edit tool call whose new text
 * holds most of the block. Derived at read time from stored tool inputs, like file activity.
 * No `node:path` here — the client imports it too.
 */

export interface AddedBlock {
  /** Inclusive new-side span. */
  start: number;
  end: number;
  lines: string[];
}

/** One edit tool call on the file, reduced to the text it put in. */
export interface AgentEdit {
  sessionId: string;
  eventId: number;
  timestamp: number;
  tool: string;
  texts: string[];
}

export interface BlockProvenance {
  start: number;
  end: number;
  sessionId: string;
  eventId: number;
  timestamp: number;
  tool: string;
}

const PATCH_SECTION = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/;

const isFile = (path: unknown, root: string, file: string) =>
  typeof path === 'string' && (path === file || path === `${root}/${file}`);

/** Codex `apply_patch`: the `+` lines of the section of `file`. */
function patchText(input: Record<string, unknown>, file: string): string[] {
  const text = [input.input, input.patch, ...(Array.isArray(input.command) ? input.command : [])]
    .filter((v): v is string => typeof v === 'string')
    .join('\n');
  const out: string[] = [];
  let inFile = false;
  for (const line of text.split('\n')) {
    const header = PATCH_SECTION.exec(line);
    if (header) inFile = header[1].trim() === file;
    else if (line.startsWith('*** ')) inFile = false;
    else if (inFile && line.startsWith('+')) out.push(line.slice(1));
  }
  return out.length ? [out.join('\n')] : [];
}

/** The text a tool call put into `file` (repo-relative under `root`); [] for any other call. */
export function editedTexts(toolName: string, inputJson: string | null, root: string, file: string): string[] {
  if (!inputJson) return [];
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(inputJson);
    if (!parsed || typeof parsed !== 'object') return [];
    input = parsed as Record<string, unknown>;
  } catch {
    // Stored inputs may be truncated: no text is better than a wrong one.
    return [];
  }
  const str = (v: unknown) => (typeof v === 'string' ? [v] : []);
  switch (toolName) {
    case 'Edit':
      return isFile(input.file_path, root, file) ? str(input.new_string) : [];
    case 'MultiEdit':
      return isFile(input.file_path, root, file) && Array.isArray(input.edits)
        ? input.edits.flatMap((e) => str((e as Record<string, unknown> | null)?.new_string))
        : [];
    case 'Write':
      return isFile(input.file_path, root, file) ? str(input.content) : [];
    case 'apply_patch':
      return patchText(input, file);
    default:
      return [];
  }
}

/** Runs of consecutive `+` lines of a file's hunks. */
export function addedBlocks(hunks: Array<{ lines: Array<{ kind: string; old?: number | null; new: number | null; text: string }> }>): AddedBlock[] {
  const blocks: AddedBlock[] = [];
  let open: AddedBlock | null = null;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind === 'add' && l.new !== null) {
        if (open && open.end === l.new - 1) {
          open.end = l.new;
          open.lines.push(l.text);
        } else {
          open = { start: l.new, end: l.new, lines: [l.text] };
          blocks.push(open);
        }
      } else if (l.kind === 'context') {
        open = null;
      }
    }
  }
  return blocks;
}

/** Words too common to tell one edit from another (`try {`, `return true;`). */
const KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'const', 'continue', 'def', 'default', 'do', 'else',
  'export', 'false', 'finally', 'fn', 'for', 'from', 'func', 'function', 'if', 'import', 'in', 'let', 'new',
  'null', 'pass', 'return', 'self', 'switch', 'this', 'true', 'try', 'type', 'undefined', 'var', 'while',
]);

/** A line that says something: one name beyond keywords. `}`, blanks and `try {` match any edit. */
const meaningful = (line: string) => (line.match(/[A-Za-z_$][\w$]*/g) ?? []).some((w) => !KEYWORDS.has(w));

/**
 * Credit the lines of each block to the edits that wrote them, as runs of one edit each.
 * A line stays with the edit that wrote the line above while that edit holds it too (so a
 * common line does not hop to another edit); otherwise it goes to the latest edit holding it.
 * Trivial lines (`}`, blanks) join the open run; lines no edit holds end it and stay out.
 */
export function attributeBlocks(blocks: AddedBlock[], edits: AgentEdit[]): BlockProvenance[] {
  const indexed = edits.map((e) => ({
    edit: e,
    lines: new Set(e.texts.flatMap((t) => t.split('\n')).map((l) => l.trim()).filter(meaningful)),
  }));
  const out: BlockProvenance[] = [];
  for (const b of blocks) {
    let run: BlockProvenance | null = null;
    b.lines.forEach((text, k) => {
      const line = b.start + k;
      const trimmed = text.trim();
      if (!meaningful(trimmed)) {
        if (run) run.end = line;
        return;
      }
      const holders = indexed.filter((x) => x.lines.has(trimmed)).map((x) => x.edit);
      const keep = run && holders.find((e) => e.eventId === run!.eventId && e.sessionId === run!.sessionId);
      if (keep) {
        run!.end = line;
        return;
      }
      const latest = holders.reduce<AgentEdit | null>((best, e) => (!best || e.timestamp >= best.timestamp ? e : best), null);
      if (!latest) {
        run = null;
        return;
      }
      const { sessionId, eventId, timestamp, tool } = latest;
      run = { start: line, end: line, sessionId, eventId, timestamp, tool };
      out.push(run);
    });
  }
  return out;
}

/** The slice of a better-sqlite3 handle this module uses (keeps the module client-safe). */
interface SqlSource {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'apply_patch'];

/** Every edit call any session of `projectPath` made on `file`, oldest first. */
export function loadAgentEdits(db: SqlSource, projectPath: string, file: string): AgentEdit[] {
  const base = file.slice(file.lastIndexOf('/') + 1);
  // The LIKE only prunes; editedTexts decides whether the call is on this file.
  const rows = db
    .prepare(
      `SELECT te.session_id AS sessionId, te.id AS eventId, te.timestamp, tt.tool_name AS tool, tt.input_json AS input
       FROM turn_tool_calls tt
       JOIN token_events te ON te.id = tt.event_id
       JOIN sessions s ON s.id = te.session_id
       WHERE s.project_path = ? AND tt.tool_name IN (${EDIT_TOOLS.map(() => '?').join(', ')})
         AND tt.input_json LIKE ?
       ORDER BY te.timestamp, tt.id`,
    )
    .all(projectPath, ...EDIT_TOOLS, `%${base}%`) as Array<Omit<AgentEdit, 'texts'> & { input: string | null }>;
  return rows.flatMap(({ input, ...r }) => {
    const texts = editedTexts(r.tool, input, projectPath, file);
    return texts.length ? [{ ...r, texts }] : [];
  });
}
