const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let key: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1]!;
      fields[key] = kv[2] ?? '';
    } else if (key && line.trim()) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  return fields;
}

const unquote = (v: string) => v.trim().replace(/^(["'])([\s\S]*)\1$/, '$2');

const basic = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

/** Multi-line literal string when possible (no escaping needed); basic string otherwise. */
function multiline(body: string): string {
  if (!body.includes("'''")) return `'''\n${body}\n'''`;
  return `"""\n${body.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')}\n"""`;
}

/**
 * Claude agent markdown -> Codex custom-agent TOML (`~/.codex/agents/<name>.toml`).
 * Only the 3 required fields are emitted: Claude-only keys (`tools`) are dropped and no
 * `model` is pinned, so the subagent inherits the parent model (see tierModel in the adapter).
 */
export function renderCodexAgent(md: string): string {
  const m = FM.exec(md);
  if (!m) throw new Error('agent markdown has no frontmatter');
  const fields = parseFields(m[1]!);
  const name = unquote(fields['name'] ?? '');
  const description = unquote(fields['description'] ?? '');
  if (!name) throw new Error('agent frontmatter is missing name');
  if (!description) throw new Error('agent frontmatter is missing description');

  return `name = ${basic(name)}\ndescription = ${basic(description)}\ndeveloper_instructions = ${multiline(m[2]!.trim())}\n`;
}
