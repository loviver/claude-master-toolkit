import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { parseSqlDump } from './dump.js';
import type { BenchRun, BenchTask } from './types.js';
import { insertRun, insertTask } from './persist.js';

export interface ImportResult {
  tasksInserted: number;
  runsInserted: number;
  turnsInserted: number;
  checksumValid: boolean;
  importId: string;
}

export function importFromSql(
  db: Database.Database,
  sql: string,
  sourceFile: string,
): ImportResult {
  const parsed = parseSqlDump(sql);
  const importedFromTag =
    (parsed.header.author ?? 'unknown') +
    '@' +
    (parsed.header.commit ? parsed.header.commit.slice(0, 7) : 'nocommit');

  let tasksInserted = 0;
  let runsInserted = 0;
  let turnsInserted = 0;
  const importId = randomUUID();

  const tx = db.transaction(() => {
    for (const t of parsed.tasks) {
      const task: BenchTask = {
        id: t.id,
        name: t.name,
        description: t.description,
        oracleJson: t.oracleJson,
        createdAt: t.createdAt,
      };
      const before = db.prepare('SELECT COUNT(*) AS n FROM bench_tasks WHERE id = ?').get(task.id) as { n: number };
      if (before.n === 0) {
        insertTask(db, task);
        tasksInserted++;
      }
    }

    for (const pr of parsed.runs) {
      const run: BenchRun = {
        id: pr.id,
        taskId: pr.taskId,
        variant: pr.variant,
        model: pr.model,
        sourceJsonl: pr.sourceJsonl,
        sessionId: pr.sessionId,
        startedAt: pr.startedAt,
        endedAt: pr.endedAt,
        wallMs: pr.wallMs,
        inputTokens: pr.inputTokens,
        outputTokens: pr.outputTokens,
        cacheRead: pr.cacheRead,
        cacheCreation: pr.cacheCreation,
        costUsd: pr.costUsd,
        turnCount: pr.turnCount,
        stopReason: pr.stopReason ?? 'unknown',
        toolCallsJson: pr.toolCallsJson ?? '[]',
        success: pr.success,
        notes: pr.notes,
        checksum: pr.checksum,
        provenanceAuthor: pr.provenanceAuthor,
        provenanceCommit: pr.provenanceCommit,
        importedFrom: importedFromTag, // re-seal by importer, not trusting payload
        createdAt: pr.createdAt,
        turns: parsed.turns
          .filter((t) => t.runId === pr.id)
          .map((t) => ({
            turnIdx: t.turnIdx,
            role: t.role,
            timestamp: t.timestamp,
            model: t.model,
            inputTokens: t.inputTokens,
            outputTokens: t.outputTokens,
            cacheRead: t.cacheRead,
            cacheCreation: t.cacheCreation,
            costUsd: t.costUsd,
            toolsJson: t.toolsJson ?? '[]',
            stopReason: t.stopReason ?? 'unknown',
          })),
      };
      const res = insertRun(db, run);
      if (res.inserted) {
        runsInserted++;
        turnsInserted += run.turns.length;
      }
    }

    db.prepare(
      `INSERT INTO bench_imports
        (id, imported_at, source_file, author, commit_sha, row_count, checksum)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      importId,
      Date.now(),
      sourceFile,
      parsed.header.author,
      parsed.header.commit,
      tasksInserted + runsInserted + turnsInserted,
      parsed.header.checksum,
    );
  });
  tx();

  return {
    tasksInserted,
    runsInserted,
    turnsInserted,
    checksumValid: parsed.checksumValid,
    importId,
  };
}
