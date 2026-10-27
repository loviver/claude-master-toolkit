/**
 * Characterization test: freezes what syncFile writes to SQLite for a Claude
 * session, table by table. Safety net for extracting the SessionSource port —
 * the refactor must keep these snapshots byte-identical.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, utimesSync } from 'fs';
import { migrate } from '../../../shared/db/migrate';
import { closeDb } from '../../../shared/db/db';
import { syncFile } from '../sync-file';
import { claudeSessionSource } from '../sources/claude';
import { CLAUDE_SESSION_ID, PART_1, PART_2 } from './fixtures/claude-session';
import { dumpSyncTables } from './helpers/db-dump';

// Pricing may come from a machine-local LiteLLM cache; pin it so snapshots are portable.
vi.mock('../../../shared/pricing.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/pricing.js')>()),
  computeCost: (model: string, t: { inputTokens: number; outputTokens: number }) =>
    (model.includes('haiku') ? 1 : 10) * t.inputTokens + 2 * t.outputTokens,
}));

const toJsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

describe('syncFile characterization (Claude JSONL → SQLite)', () => {
  let dir: string;
  let dbPath: string;
  let sessionFile: string;

  const dump = () => dumpSyncTables(dbPath, dir);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ctk-char-'));
    dbPath = join(dir, 'ctk.sqlite');
    process.env.CTK_DB_PATH = dbPath;
    closeDb();
    migrate();
    const projectDir = join(dir, 'projects', '-home-dev-acme-app');
    mkdirSync(projectDir, { recursive: true });
    sessionFile = join(projectDir, `${CLAUDE_SESSION_ID}.jsonl`);
  });

  afterEach(() => {
    closeDb();
    delete process.env.CTK_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('full sync writes the expected rows in every table', async () => {
    writeFileSync(sessionFile, toJsonl([...PART_1, ...PART_2]));
    await syncFile(sessionFile);
    expect(dump()).toMatchSnapshot();
  });

  it('incremental sync (append) converges to the same rows as a full sync', async () => {
    writeFileSync(sessionFile, toJsonl(PART_1));
    await syncFile(sessionFile);
    const afterFirst = dump();

    appendFileSync(sessionFile, toJsonl(PART_2));
    const later = new Date(Date.now() + 5_000);
    utimesSync(sessionFile, later, later);
    await syncFile(sessionFile);

    expect(afterFirst).toMatchSnapshot('after part 1');
    expect(dump()).toMatchSnapshot('after part 2');
  });

  it('stamps the session with the agent of the source that read it', async () => {
    writeFileSync(sessionFile, toJsonl([...PART_1, ...PART_2]));
    await syncFile(sessionFile, { ...claudeSessionSource, agent: 'codex' });
    expect(dump().sessions).toEqual([expect.objectContaining({ agent: 'codex' })]);
  });

  it('re-syncing an unchanged file is a no-op', async () => {
    writeFileSync(sessionFile, toJsonl([...PART_1, ...PART_2]));
    await syncFile(sessionFile);
    const before = dump();
    await syncFile(sessionFile);
    expect(dump()).toEqual(before);
  });
});
