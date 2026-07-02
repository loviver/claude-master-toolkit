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

  afterEach(async () => {
    // Drain fire-and-forget executor promises before dropping the DB
    await new Promise((r) => setTimeout(r, 50));
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

  // ── wf_mutate ──

  it('wf_mutate adds a node and bumps plan version', async () => {
    const created = parse(wfHandlers.wf_create({ name: 'test', definition: SIMPLE_PLAN }));
    const exec = parse(await wfHandlers.wf_execute({ plan_id: created.id }));

    const result = parse(
      wfHandlers.wf_mutate({
        execution_id: exec.execution_id,
        op: {
          op: 'addNode',
          after: 'step1',
          node: {
            id: 'injected',
            type: 'bash',
            label: 'Injected',
            config: { command: 'date' },
            edges: [],
          },
        },
      }),
    );

    expect(result.op).toBe('addNode');
    expect(result.version).toBe(2);
    expect(result.nodes).toBe(3);

    const plan = parse(wfHandlers.wf_get({ plan_id: created.id }));
    expect(plan.definition.nodes.find((n: any) => n.id === 'injected')).toBeTruthy();
    const step1 = plan.definition.nodes.find((n: any) => n.id === 'step1');
    expect(step1.edges[0].target).toBe('injected');
  });

  it('wf_mutate records entry in mutation log', async () => {
    const created = parse(wfHandlers.wf_create({ name: 'test', definition: SIMPLE_PLAN }));
    const exec = parse(await wfHandlers.wf_execute({ plan_id: created.id }));
    await new Promise((r) => setTimeout(r, 50));

    wfHandlers.wf_mutate({
      execution_id: exec.execution_id,
      by_node_id: 'step1',
      op: {
        op: 'updateNode',
        id: 'step2',
        patch: { label: 'Renamed' },
      },
    });

    const log = parse(wfHandlers.wf_mutation_log({ execution_id: exec.execution_id }));
    expect(log.count).toBe(1);
    expect(log.entries[0].byNodeId).toBe('step1');
    expect(log.entries[0].op.op).toBe('updateNode');
  });

  it('wf_mutate rejects mutation that creates a cycle', async () => {
    const created = parse(wfHandlers.wf_create({ name: 'test', definition: SIMPLE_PLAN }));
    const exec = parse(await wfHandlers.wf_execute({ plan_id: created.id }));

    const r = wfHandlers.wf_mutate({
      execution_id: exec.execution_id,
      op: {
        op: 'updateNode',
        id: 'step2',
        patch: { edges: [{ target: 'step1' }] },
      },
    }) as McpResult;
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/cycle/);
  });

  it('wf_mutate errors for unknown execution', () => {
    const r = wfHandlers.wf_mutate({
      execution_id: 'no-such-id',
      op: { op: 'removeNode', id: 'x', mode: 'skip' },
    }) as McpResult;
    expect(r.isError).toBe(true);
  });
});
