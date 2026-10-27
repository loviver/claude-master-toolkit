/**
 * Codex rollout → SQLite through the same agnostic pipeline Claude uses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, utimesSync } from 'fs';
import { migrate } from '../../../shared/db/migrate';
import { closeDb } from '../../../shared/db/db';
import { syncFile } from '../sync-file';
import { createCodexSessionSource } from '../sources/codex';
import type { SessionSource } from '../sources/types';
import { CODEX_ROLLOUT_NAME, PART_1, PART_2, SESSION_INDEX } from './fixtures/codex-rollout';
import { dumpSyncTables } from './helpers/db-dump';

// Pricing may come from a machine-local LiteLLM cache; pin it so snapshots are portable.
vi.mock('../../../shared/pricing.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/pricing.js')>()),
  computeCost: (model: string, t: { inputTokens: number; outputTokens: number }) =>
    (model.includes('mini') ? 1 : 10) * t.inputTokens + 2 * t.outputTokens,
}));

const toJsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

describe('syncFile (Codex rollout → SQLite)', () => {
  let dir: string;
  let dbPath: string;
  let rollout: string;
  let source: SessionSource;

  const dump = () => dumpSyncTables(dbPath, dir);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ctk-codex-sync-'));
    dbPath = join(dir, 'ctk.sqlite');
    process.env.CTK_DB_PATH = dbPath;
    closeDb();
    migrate();
    const home = join(dir, 'codex');
    const dayDir = join(home, 'sessions', '2026', '10', '26');
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(home, 'session_index.jsonl'), toJsonl(SESSION_INDEX));
    rollout = join(dayDir, CODEX_ROLLOUT_NAME);
    source = createCodexSessionSource({ home });
  });

  afterEach(() => {
    closeDb();
    delete process.env.CTK_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a codex session with its responses, tool calls and content', async () => {
    writeFileSync(rollout, toJsonl([...PART_1, ...PART_2]));
    await syncFile(rollout, source);

    const db = dump();
    expect(db.sessions).toEqual([
      expect.objectContaining({
        agent: 'codex',
        primary_model: 'gpt-5-codex',
        custom_title: 'Fix login bug',
        turn_count: 4,
        total_input_tokens: 3058,
        total_cache_read_tokens: 23952,
        total_output_tokens: 251,
        // 10×(2220+338) + 2×(136+75) + 1×(400+100) + 2×(30+10)
        total_cost_usd: 26582,
      }),
    ]);
    expect(db).toMatchSnapshot();
  });

  it('incremental sync (append) does not duplicate responses', async () => {
    writeFileSync(rollout, toJsonl(PART_1));
    await syncFile(rollout, source);

    appendFileSync(rollout, toJsonl(PART_2));
    const later = new Date(Date.now() + 5_000);
    utimesSync(rollout, later, later);
    await syncFile(rollout, source);

    const db = dump();
    expect(db.token_events.map((e) => (e as { uuid: string }).uuid)).toEqual([
      'resp_0001',
      'resp_0002',
      'resp_0003',
      'resp_0004',
    ]);
    expect(db.turn_tool_calls).toHaveLength(2);
    expect(db.turn_content.filter((c) => (c as { role: string }).role === 'tool_result')).toHaveLength(2);
  });
});
