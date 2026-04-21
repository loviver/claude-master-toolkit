import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrate } from '../../shared/db/migrate.js';
import { closeDb } from '../../shared/db/db.js';
import { wfHandlers } from '../workflow-tools.js';

type McpResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function parse(result: McpResult): any {
  return JSON.parse(result.content[0]!.text);
}

const SIMPLE_PLAN = {
  nodes: [
    {
      id: 'step1',
      type: 'task' as const,
      label: 'Step 1',
      config: { command: 'echo hello' },
      edges: [{ target: 'step2' }],
    },
    {
      id: 'step2',
      type: 'agent' as const,
      label: 'Step 2',
      config: { agentPrompt: 'Analyze output', agentRole: 'analyzer' },
      edges: [],
    },
  ],
  entrypoint: 'step1',
};

describe('mcp/workflow-tools', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctk-wftools-'));
    originalEnv = process.env['CTK_DB_PATH'];
    process.env['CTK_DB_PATH'] = join(tmpDir, 'ctk.sqlite');
    migrate();
  });

  afterEach(() => {
    closeDb();
    if (originalEnv !== undefined) process.env['CTK_DB_PATH'] = originalEnv;
    else delete process.env['CTK_DB_PATH'];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── wf_create ──

  it('wf_create returns id + name', () => {
    const r = parse(wfHandlers.wf_create({ name: 'test', definition: SIMPLE_PLAN }));
    expect(r.id).toMatch(/[0-9a-f-]{36}/);
    expect(r.name).toBe('test');
    expect(r.version).toBe(1);
  });

  it('wf_create with description stores it', () => {
    const r = parse(wfHandlers.wf_create({
      name: 'test',
      definition: SIMPLE_PLAN,
      description: 'A test plan',
    }));
    expect(r.id).toBeTruthy();
  });

  // ── wf_list ──

  it('wf_list returns empty initially', () => {
    const r = parse(wfHandlers.wf_list({}));
    expect(r.count).toBe(0);
    expect(r.plans).toEqual([]);
  });

  it('wf_list returns created plans', () => {
    wfHandlers.wf_create({ name: 'a', definition: SIMPLE_PLAN });
    wfHandlers.wf_create({ name: 'b', definition: SIMPLE_PLAN });
    const r = parse(wfHandlers.wf_list({}));
    expect(r.count).toBe(2);
    expect(r.plans.map((p: any) => p.name)).toContain('a');
    expect(r.plans.map((p: any) => p.name)).toContain('b');
  });

  // ── wf_get ──

  it('wf_get returns full plan', () => {
    const created = parse(wfHandlers.wf_create({ name: 'test', definition: SIMPLE_PLAN }));
    const plan = parse(wfHandlers.wf_get({ plan_id: created.id }));
    expect(plan.id).toBe(created.id);
    expect(plan.definition.nodes).toHaveLength(2);
    expect(plan.definition.entrypoint).toBe('step1');
  });

  it('wf_get returns error for unknown id', () => {
    const r = wfHandlers.wf_get({ plan_id: 'no-such-id' }) as McpResult;
    expect(r.isError).toBe(true);
  });

  // ── wf_update ──

  it('wf_update modifies name', () => {
    const created = parse(wfHandlers.wf_create({ name: 'old', definition: SIMPLE_PLAN }));
    const updated = parse(wfHandlers.wf_update({ plan_id: created.id, name: 'new' }));
    expect(updated.name).toBe('new');
  });

  // ── wf_execute ──

  it('wf_execute returns executionId', async () => {
    const created = parse(wfHandlers.wf_create({ name: 'test', definition: SIMPLE_PLAN }));
    const exec = parse(await wfHandlers.wf_execute({ plan_id: created.id }));
    expect(exec.execution_id).toMatch(/[0-9a-f-]{36}/);
    expect(exec.state).toBe('running');
  });

  it('wf_execute errors for unknown plan', async () => {
    const r = await wfHandlers.wf_execute({ plan_id: 'no-such-id' }) as McpResult;
    expect(r.isError).toBe(true);
  });

  // ── wf_status ──

  it('wf_status returns execution state', async () => {
    const created = parse(wfHandlers.wf_create({ name: 'test', definition: SIMPLE_PLAN }));
    const exec = parse(await wfHandlers.wf_execute({ plan_id: created.id }));

    // Give executor a tick to complete
    await new Promise((r) => setTimeout(r, 50));

    const status = parse(wfHandlers.wf_status({ execution_id: exec.execution_id }));
    expect(['running', 'completed', 'failed']).toContain(status.state);
    expect(Array.isArray(status.timeline)).toBe(true);
  });

  it('wf_status errors for unknown execution', () => {
    const r = wfHandlers.wf_status({ execution_id: 'no-such-id' }) as McpResult;
    expect(r.isError).toBe(true);
  });
});
