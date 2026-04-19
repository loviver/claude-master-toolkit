import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseSkillFrontmatter,
  scanSkillsDir,
  renderRegistry,
  runSkillRegistry,
} from '../skill-registry.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ctk-skill-reg-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('parseSkillFrontmatter', () => {
  it('parses name and description from YAML frontmatter', () => {
    const body = `---
name: delegate
description: Wrapper for Agent tool.
---

# content`;
    const r = parseSkillFrontmatter(body);
    expect(r?.name).toBe('delegate');
    expect(r?.description).toBe('Wrapper for Agent tool.');
  });

  it('returns null when no frontmatter', () => {
    expect(parseSkillFrontmatter('# just a heading')).toBeNull();
  });

  it('returns null when frontmatter missing required fields', () => {
    const body = `---
foo: bar
---
content`;
    expect(parseSkillFrontmatter(body)).toBeNull();
  });

  it('handles multiline descriptions', () => {
    const body = `---
name: x
description: Line one line two.
---`;
    expect(parseSkillFrontmatter(body)?.description).toBe('Line one line two.');
  });
});

describe('scanSkillsDir', () => {
  it('returns empty array for missing dir', () => {
    expect(scanSkillsDir(join(tmp, 'nope'))).toEqual([]);
  });

  it('finds SKILL.md in each subdirectory', () => {
    mkdirSync(join(tmp, 'a'));
    mkdirSync(join(tmp, 'b'));
    writeFileSync(join(tmp, 'a/SKILL.md'), '---\nname: a\ndescription: A skill.\n---\n');
    writeFileSync(join(tmp, 'b/SKILL.md'), '---\nname: b\ndescription: B skill.\n---\n');
    const r = scanSkillsDir(tmp);
    expect(r).toHaveLength(2);
    expect(r.map((s) => s.name).sort()).toEqual(['a', 'b']);
  });

  it('skips directories without SKILL.md', () => {
    mkdirSync(join(tmp, 'a'));
    expect(scanSkillsDir(tmp)).toEqual([]);
  });

  it('skips skills with malformed frontmatter', () => {
    mkdirSync(join(tmp, 'a'));
    writeFileSync(join(tmp, 'a/SKILL.md'), '# no frontmatter');
    expect(scanSkillsDir(tmp)).toEqual([]);
  });
});

describe('renderRegistry', () => {
  it('renders markdown table with all entries', () => {
    const md = renderRegistry([
      { name: 'a', description: 'A skill.', path: '/x/a/SKILL.md', source: 'project' },
      { name: 'b', description: 'B skill.', path: '/x/b/SKILL.md', source: 'global' },
    ]);
    expect(md).toContain('| a |');
    expect(md).toContain('| b |');
    expect(md).toContain('A skill.');
    expect(md).toContain('project');
  });

  it('handles empty list', () => {
    const md = renderRegistry([]);
    expect(md).toContain('No skills found');
  });
});

describe('runSkillRegistry', () => {
  it('writes .ctk/skill-registry.md with scanned skills', () => {
    const skillsDir = join(tmp, 'skills');
    mkdirSync(join(skillsDir, 'foo'), { recursive: true });
    writeFileSync(
      join(skillsDir, 'foo/SKILL.md'),
      '---\nname: foo\ndescription: Foo skill.\n---\n',
    );
    const r = runSkillRegistry({ cwd: tmp, sources: [{ path: skillsDir, label: 'project' }] });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.name).toBe('foo');
    expect(existsSync(join(tmp, '.ctk/skill-registry.md'))).toBe(true);
    const md = readFileSync(join(tmp, '.ctk/skill-registry.md'), 'utf-8');
    expect(md).toContain('foo');
    expect(md).toContain('Foo skill.');
  });

  it('dedupes skills by name (first source wins)', () => {
    const a = join(tmp, 'a');
    const b = join(tmp, 'b');
    mkdirSync(join(a, 'x'), { recursive: true });
    mkdirSync(join(b, 'x'), { recursive: true });
    writeFileSync(join(a, 'x/SKILL.md'), '---\nname: x\ndescription: from A.\n---\n');
    writeFileSync(join(b, 'x/SKILL.md'), '---\nname: x\ndescription: from B.\n---\n');
    const r = runSkillRegistry({
      cwd: tmp,
      sources: [
        { path: a, label: 'project' },
        { path: b, label: 'global' },
      ],
    });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.description).toBe('from A.');
  });
});
