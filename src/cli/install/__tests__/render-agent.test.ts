import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse } from 'smol-toml';
import { renderCodexAgent } from '../render-agent.js';

const MD = `---
name: sdd-explore
description: Investigates a topic. Use for "how does X work?" questions.
tools: Bash, Read, Grep, Glob
---

# sdd-explore

You are the **explorer**. Path: C:\\temp and "quotes" and \`\`\` fences.
`;

describe('renderCodexAgent', () => {
  it('emits the 3 required Codex fields and round-trips through a TOML parser', () => {
    const t = parse(renderCodexAgent(MD)) as Record<string, unknown>;
    expect(t['name']).toBe('sdd-explore');
    expect(t['description']).toBe('Investigates a topic. Use for "how does X work?" questions.');
    expect(t['developer_instructions']).toContain('You are the **explorer**.');
    expect(t['developer_instructions']).toContain('C:\\temp and "quotes"');
  });

  it('drops Claude-only frontmatter (tools) and never pins a model', () => {
    const out = renderCodexAgent(MD);
    expect(out).not.toMatch(/^tools\s*=/m);
    expect(out).not.toMatch(/^model\s*=/m);
  });

  it('survives a body containing triple quotes', () => {
    const t = parse(renderCodexAgent(MD.replace('fences.', "''' and \"\"\" both"))) as any;
    expect(t.developer_instructions).toContain(`''' and """ both`);
  });

  it('rejects markdown without name/description', () => {
    expect(() => renderCodexAgent('# no frontmatter')).toThrow(/frontmatter/);
    expect(() => renderCodexAgent('---\nname: x\n---\nbody')).toThrow(/description/);
  });

  it('every shipped agent renders to valid TOML', () => {
    const dir = join(__dirname, '..', '..', '..', '..', 'claude-dist', 'agents');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      const t = parse(renderCodexAgent(readFileSync(join(dir, f), 'utf8'))) as any;
      expect(t.name).toBe(f.replace(/\.md$/, ''));
      expect(t.developer_instructions.length).toBeGreaterThan(50);
    }
  });
});
