import { readFile } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import {
  parseJsonlFile,
  extractEnrichedTokenEvents,
  extractSessionMeta,
} from '../jsonl-parser/index.js';
import { computeCost, resolveModelKey } from '../pricing.js';
import type { BenchRun, BenchTurn, IngestOptions } from './types.js';

export async function parseJsonlForBench(
  filePath: string,
  opts: IngestOptions,
): Promise<BenchRun> {
  const raw = await readFile(filePath);
  const checksum = createHash('sha256').update(raw).digest('hex');

  const events = await parseJsonlFile(filePath);
  const meta = extractSessionMeta(events);
  const enriched = extractEnrichedTokenEvents(events);

  const model = opts.model ?? meta.primaryModel;

  const turns: BenchTurn[] = enriched.map((e, idx) => {
    const turnCost = computeCost(resolveModelKey(e.model), e.usage);
    return {
      turnIdx: idx,
      role: 'assistant',
      timestamp: Date.parse(e.timestamp),
      model: e.model,
      inputTokens: e.usage.inputTokens,
      outputTokens: e.usage.outputTokens,
      cacheRead: e.usage.cacheReadTokens,
      cacheCreation: e.usage.cacheCreationTokens,
      costUsd: turnCost,
      toolsJson: JSON.stringify(e.toolsUsed),
      stopReason: e.stopReason,
    };
  });

  const totals = turns.reduce(
    (acc, t) => ({
      input: acc.input + t.inputTokens,
      output: acc.output + t.outputTokens,
      cacheR: acc.cacheR + t.cacheRead,
      cacheW: acc.cacheW + t.cacheCreation,
      cost: acc.cost + t.costUsd,
    }),
    { input: 0, output: 0, cacheR: 0, cacheW: 0, cost: 0 },
  );

  const uniqueTools = [...new Set(turns.flatMap((t) => JSON.parse(t.toolsJson) as string[]))].sort();

  const startedAt = Date.parse(meta.startedAt);
  const endedAt = Date.parse(meta.lastActiveAt);

  return {
    id: randomUUID(),
    taskId: opts.taskId,
    variant: opts.variant,
    model,
    sourceJsonl: filePath,
    sessionId: meta.sessionId,
    startedAt,
    endedAt,
    wallMs: endedAt - startedAt,
    inputTokens: totals.input,
    outputTokens: totals.output,
    cacheRead: totals.cacheR,
    cacheCreation: totals.cacheW,
    costUsd: totals.cost,
    turnCount: turns.length,
    stopReason: turns.at(-1)?.stopReason ?? 'unknown',
    toolCallsJson: JSON.stringify(uniqueTools),
    success: opts.success ?? null,
    notes: opts.notes ?? null,
    checksum,
    provenanceAuthor: opts.author ?? null,
    provenanceCommit: opts.commit ?? null,
    importedFrom: null,
    createdAt: Date.now(),
    turns,
  };
}
