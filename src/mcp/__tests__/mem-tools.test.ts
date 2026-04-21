import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { migrate } from '../../shared/db/migrate.js';
import { memHandlers } from '../mem-tools.js';

type McpResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function parse(result: McpResult): any {
  return JSON.parse(result.content[0]!.text);
}

describe('mcp/mem-tools', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ctk-memtool-'));
    originalEnv = process.env['CTK_DB_PATH'];
    process.env['CTK_DB_PATH'] = join(tmpDir, 'ctk.sqlite');
    migrate();
  });

  afterEach(() => {
    if (originalEnv !== undefined) process.env['CTK_DB_PATH'] = originalEnv;
    else delete process.env['CTK_DB_PATH'];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('mem_save returns saved+id and row is retrievable via mem_get', () => {
    const saved = parse(memHandlers.mem_save({ title: 'hello', type: 'note', what: 'world' }));
    expect(saved.saved).toBe(true);
    expect(saved.id).toMatch(/[0-9a-f-]{36}/);

    const got = parse(memHandlers.mem_get({ id: saved.id }));
    expect(got.title).toBe('hello');
    expect(got.what).toBe('world');
    expect(got.access_count).toBe(1);
  });

  it('mem_update modifies a row', () => {
    const saved = parse(memHandlers.mem_save({ title: 'a', type: 'note', what: 'x' }));
    const updated = parse(memHandlers.mem_update({ id: saved.id, what: 'y' }));
    expect(updated.what).toBe('y');
  });

  it('mem_delete returns deleted:true and row gone', () => {
    const saved = parse(memHandlers.mem_save({ title: 'a', type: 'note', what: 'x' }));
    const del = parse(memHandlers.mem_delete({ id: saved.id }));
    expect(del.deleted).toBe(true);

    const missing = memHandlers.mem_get({ id: saved.id }) as McpResult;
    expect(missing.isError).toBe(true);
  });

  it('mem_mark sets topic_key', () => {
    const saved = parse(memHandlers.mem_save({ title: 'a', type: 'note', what: 'x' }));
    const marked = parse(memHandlers.mem_mark({ id: saved.id, topic_key: 'my/key' }));
    expect(marked.topic_key).toBe('my/key');
  });

  it('mem_recall returns count + results + BM25 order', () => {
    memHandlers.mem_save({ title: 'a1', type: 'note', what: 'alpha' });
    memHandlers.mem_save({ title: 'a2', type: 'note', what: 'alpha alpha alpha' });
    const r = parse(memHandlers.mem_recall({ query: 'alpha' }));
    expect(r.count).toBe(2);
    expect(r.results[0].title).toBe('a2');
  });

  it('mem_context returns project-scoped rows', () => {
    memHandlers.mem_save({ title: 'a', type: 'note', what: 'x', project_path: '/p1' });
    memHandlers.mem_save({ title: 'b', type: 'note', what: 'y', project_path: '/p2' });
    const r = parse(memHandlers.mem_context({ project_path: '/p1' }));
    expect(r.count).toBe(1);
    expect(r.memories[0].title).toBe('a');
  });

  it('mem_trace returns ordered list', () => {
    memHandlers.mem_save({ title: 'a', type: 'note', what: 'x' });
    const r = parse(memHandlers.mem_trace({ limit: 5 }));
    expect(r.count).toBe(1);
  });

  it('mem_session sub=summary saves type=session_summary with topic_key session/{sid}', () => {
    const r = parse(memHandlers.mem_session({ sub: 'summary', session_id: 's1', content: 'done' }));
    expect(r.saved).toBe(true);
    expect(r.topic_key).toBe('session/s1');
  });

  it('mem_session sub=start writes a marker memory', () => {
    const r = parse(memHandlers.mem_session({ sub: 'start', session_id: 's2' }));
    expect(r.saved).toBe(true);
    expect(r.topic_key).toBe('session/start/s2');
  });

  it('mem_session sub=end writes a marker memory', () => {
    const r = parse(memHandlers.mem_session({ sub: 'end', session_id: 's3', summary: 'bye' }));
    expect(r.saved).toBe(true);
    expect(r.topic_key).toBe('session/end/s3');
  });

  it('mem_passive saves a note memory', () => {
    const r = parse(memHandlers.mem_passive({ content: 'observed', source: 'hook' }));
    expect(r.saved).toBe(true);
  });

  it('mem_merge moves memories between projects', () => {
    memHandlers.mem_save({ title: 'a', type: 'note', what: 'x', project_path: '/old' });
    memHandlers.mem_save({ title: 'b', type: 'note', what: 'y', project_path: '/old' });
    const r = parse(memHandlers.mem_merge({ from: '/old', to: '/new' }));
    expect(r.moved).toBe(2);
  });

  it('mem_suggest returns ranked topic_keys', () => {
    memHandlers.mem_save({ title: 'auth model', type: 'architecture', what: 'tokens', topic_key: 'arch/auth' });
    const r = parse(memHandlers.mem_suggest({ title: 'auth tokens rotation' }));
    expect(r.hints.length).toBeGreaterThan(0);
    expect(r.hints[0].topic_key).toBe('arch/auth');
  });

  it('mem_stats returns counts', () => {
    memHandlers.mem_save({ title: 'a', type: 'decision', what: 'x' });
    memHandlers.mem_save({ title: 'b', type: 'note', what: 'y' });
    const r = parse(memHandlers.mem_stats({}));
    expect(r.memoriesTotal).toBe(2);
  });

  it('mem_export / mem_import round-trip', () => {
    memHandlers.mem_save({ title: 'a', type: 'note', what: 'x' });
    const dump = parse(memHandlers.mem_export({}));
    expect(dump.memories.length).toBe(1);

    const again = parse(memHandlers.mem_import({ dump }));
    expect(again.imported + again.skipped).toBe(1);
  });
});
