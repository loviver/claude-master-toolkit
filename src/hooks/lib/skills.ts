import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseRegistry, type SkillGlobs } from '../guards/edit-guard.js';

const FM = /^---\r?\n([\s\S]*?)\r?\n---/;

/** `paths:` (or `globs:`) from SKILL.md frontmatter: comma-separated file globs. */
export function frontmatterGlobs(body: string): string[] {
  const fm = FM.exec(body)?.[1];
  if (!fm) return [];
  const m = /^(?:paths|globs):\s*(.+)$/m.exec(fm);
  if (!m) return [];
  return m[1]!
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((g) => g.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

export function loadSkillGlobs(cwd: string): SkillGlobs[] {
  const registry = join(cwd, '.ctk', 'skill-registry.md');
  if (!existsSync(registry)) return [];
  const out: SkillGlobs[] = [];
  for (const row of parseRegistry(readFileSync(registry, 'utf8'))) {
    try {
      const globs = frontmatterGlobs(readFileSync(row.path, 'utf8'));
      if (globs.length) out.push({ name: row.name, globs });
    } catch {
      /* unreadable skill: skip */
    }
  }
  return out;
}
