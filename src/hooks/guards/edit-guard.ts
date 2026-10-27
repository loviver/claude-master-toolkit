import { isAbsolute, relative } from 'path';
import type { HookEvent, HookResult } from '../runtime/types.js';

export interface RegistryRow {
  name: string;
  source: string;
  description: string;
  path: string;
}

/** A skill that declares file globs (SKILL.md frontmatter `paths:`). */
export interface SkillGlobs {
  name: string;
  globs: string[];
}

/** Parses the table written by `ctk skill-registry`: | Name | Source | Description | Path |. */
export function parseRegistry(md: string): RegistryRow[] {
  const rows: RegistryRow[] = [];
  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    // Split on unescaped pipes only (descriptions escape `|` as `\|`).
    const cells = line
      .slice(1)
      .replace(/\|\s*$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|'));
    if (cells.length < 4) continue;
    const [name, source, description, path] = cells as [string, string, string, string];
    if (name === 'Name' || /^-+$/.test(name)) continue;
    rows.push({ name, source, description, path });
  }
  return rows;
}

export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export interface EditGuardDeps {
  skills: SkillGlobs[];
}

/** Non-blocking: hints which skills to load for the file being edited. */
export function editGuard(event: HookEvent, deps: EditGuardDeps): HookResult {
  const files = event.tool?.filePaths;
  if (!files?.length) return { kind: 'noop' };

  let hints = '';
  for (const skill of deps.skills) {
    let hit: string | undefined;
    for (const glob of skill.globs) {
      const re = globToRegExp(glob);
      if (files.some((f) => re.test(isAbsolute(f) ? relative(event.cwd, f) : f))) {
        hit = glob;
        break;
      }
    }
    if (hit) hints += `[ctk-skill-hint] load ${skill.name} (trigger: ${hit})\n`;
  }
  return hints ? { kind: 'context', text: hints } : { kind: 'noop' };
}
