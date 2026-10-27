import { describe, it, expect } from 'vitest';
import { addedBlocks, attributeBlocks, editedTexts, type AgentEdit } from '../line-provenance';

const ROOT = '/repo';

describe('editedTexts', () => {
  it('reads what Edit, MultiEdit and Write put into the file', () => {
    expect(editedTexts('Edit', JSON.stringify({ file_path: '/repo/src/a.ts', new_string: 'x' }), ROOT, 'src/a.ts')).toEqual(['x']);
    expect(editedTexts('MultiEdit', JSON.stringify({ file_path: '/repo/src/a.ts', edits: [{ new_string: 'a' }, { new_string: 'b' }] }), ROOT, 'src/a.ts'))
      .toEqual(['a', 'b']);
    expect(editedTexts('Write', JSON.stringify({ file_path: 'src/a.ts', content: 'all' }), ROOT, 'src/a.ts')).toEqual(['all']);
  });

  it('ignores calls on another file, reads, and unparsable (truncated) input', () => {
    expect(editedTexts('Edit', JSON.stringify({ file_path: '/repo/src/ab.ts', new_string: 'x' }), ROOT, 'src/a.ts')).toEqual([]);
    expect(editedTexts('Read', JSON.stringify({ file_path: '/repo/src/a.ts' }), ROOT, 'src/a.ts')).toEqual([]);
    expect(editedTexts('Edit', '{"file_path":"/repo/src/a.ts","new_str', ROOT, 'src/a.ts')).toEqual([]);
  });

  it('reads the + lines of the file section of a Codex apply_patch', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      '-old',
      '+new one',
      ' ctx',
      '*** Update File: src/b.ts',
      '+other',
      '*** End Patch',
    ].join('\n');
    expect(editedTexts('apply_patch', JSON.stringify({ input: patch }), ROOT, 'src/a.ts')).toEqual(['new one']);
  });
});

describe('addedBlocks', () => {
  it('groups consecutive + lines into new-side spans', () => {
    const blocks = addedBlocks([
      {
        lines: [
          { kind: 'context', old: 1, new: 1, text: 'a' },
          { kind: 'del', old: 2, new: null, text: 'b' },
          { kind: 'add', old: null, new: 2, text: 'B' },
          { kind: 'add', old: null, new: 3, text: 'C' },
          { kind: 'context', old: 3, new: 4, text: 'd' },
          { kind: 'add', old: null, new: 5, text: 'E' },
        ],
      },
    ]);
    expect(blocks).toEqual([
      { start: 2, end: 3, lines: ['B', 'C'] },
      { start: 5, end: 5, lines: ['E'] },
    ]);
  });
});

describe('attributeBlocks', () => {
  const edit = (eventId: number, timestamp: number, texts: string[]): AgentEdit =>
    ({ sessionId: 's', eventId, timestamp, tool: 'Edit', texts });

  it('keeps crediting the edit that wrote the previous line while it holds the next one', () => {
    const out = attributeBlocks(
      [{ start: 10, end: 11, lines: ['  const total = sum(a);', '  return total;'] }],
      [edit(1, 100, ['const total = sum(a);\nreturn total;']), edit(2, 200, ['return total;'])],
    );
    expect(out).toEqual([{ start: 10, end: 11, sessionId: 's', eventId: 1, timestamp: 100, tool: 'Edit' }]);
  });

  it('splits a block (a whole new file) between the edits that wrote its parts', () => {
    const out = attributeBlocks(
      [{ start: 1, end: 6, lines: ['import a;', 'function f() {', '  old();', '}', 'function g() {', '}'] }],
      [edit(1, 100, ['import a;\nfunction f() {\n  old();\n}']), edit(2, 200, ['function g() {\n}'])],
    );
    expect(out.map((p) => [p.start, p.end, p.eventId])).toEqual([[1, 4, 1], [5, 6, 2]]);
  });

  it('breaks a tie with the latest edit', () => {
    const out = attributeBlocks([{ start: 1, end: 1, lines: ['title?: string;'] }], [edit(1, 100, ['title?: string;']), edit(2, 200, ['title?: string;'])]);
    expect(out[0].eventId).toBe(2);
  });

  it('leaves a block nobody wrote, or of trivial lines only, unattributed', () => {
    const edits = [edit(1, 100, ['}\nfoo()'])];
    expect(attributeBlocks([{ start: 1, end: 1, lines: ['bar()'] }], edits)).toEqual([]);
    expect(attributeBlocks([{ start: 1, end: 2, lines: ['}', ''] }], edits)).toEqual([]);
  });

  it('does not start a run on keyword-only lines any edit may hold', () => {
    const edits = [edit(1, 100, ['try {\n} catch {\nreturn true;\nimport type {'])];
    const lines = ['try {', '  run();', '} catch {', '  return true;', 'import type {'];
    expect(attributeBlocks([{ start: 1, end: 5, lines }], edits)).toEqual([]);
  });

  it('credits only the lines an edit wrote, not the rest of the block', () => {
    const edits = [edit(1, 100, ['alpha()\ngamma()'])];
    const out = attributeBlocks([{ start: 1, end: 3, lines: ['alpha()', 'beta()', 'gamma()'] }], edits);
    expect(out.map((p) => [p.start, p.end])).toEqual([[1, 1], [3, 3]]);
  });
});

describe('loadAgentEdits', () => {
  it('reads the edit calls on a file across the sessions of a project, oldest first', async () => {
    const { default: Database } = await import('better-sqlite3');
    const { mkdtempSync, rmSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const { migrate } = await import('../../db/migrate');
    const { closeDb } = await import('../../db/db');
    const { loadAgentEdits } = await import('../line-provenance');

    const dir = mkdtempSync(join(tmpdir(), 'ctk-prov-'));
    const dbPath = join(dir, 'ctk.sqlite');
    process.env.CTK_DB_PATH = dbPath;
    closeDb();
    migrate();
    closeDb();
    const db = new Database(dbPath);
    try {
      const session = db.prepare(
        `INSERT INTO sessions (id, project_path, started_at, last_active_at, primary_model, turn_count,
           total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens,
           total_cost_usd, jsonl_file) VALUES (?, ?, 0, 0, 'm', 0, 0, 0, 0, 0, 0, ?)`,
      );
      session.run('s1', '/repo', '/tmp/s1.jsonl');
      session.run('s2', '/other', '/tmp/s2.jsonl');
      const event = db.prepare(`INSERT INTO token_events (session_id, timestamp, model) VALUES (?, ?, 'm')`);
      const late = Number(event.run('s1', 200).lastInsertRowid);
      const early = Number(event.run('s1', 100).lastInsertRowid);
      const foreign = Number(event.run('s2', 300).lastInsertRowid);
      const tool = db.prepare(`INSERT INTO turn_tool_calls (event_id, tool_use_id, tool_name, input_json) VALUES (?, ?, ?, ?)`);
      tool.run(late, 't1', 'Edit', JSON.stringify({ file_path: '/repo/src/a.ts', new_string: 'late' }));
      tool.run(early, 't2', 'Write', JSON.stringify({ file_path: '/repo/src/a.ts', content: 'early' }));
      tool.run(early, 't3', 'Read', JSON.stringify({ file_path: '/repo/src/a.ts' }));
      tool.run(early, 't4', 'Edit', JSON.stringify({ file_path: '/repo/src/b.ts', new_string: 'b' }));
      tool.run(foreign, 't5', 'Edit', JSON.stringify({ file_path: '/repo/src/a.ts', new_string: 'foreign' }));

      expect(loadAgentEdits(db, '/repo', 'src/a.ts')).toEqual([
        { sessionId: 's1', eventId: early, timestamp: 100, tool: 'Write', texts: ['early'] },
        { sessionId: 's1', eventId: late, timestamp: 200, tool: 'Edit', texts: ['late'] },
      ]);
    } finally {
      db.close();
      delete process.env.CTK_DB_PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
