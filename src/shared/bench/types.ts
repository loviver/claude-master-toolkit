export type BenchVariant = 'ctk' | 'baseline';

export interface BenchTask {
  id: string;
  name: string;
  description: string | null;
  oracleJson: string | null;
  createdAt: number;
}

export interface BenchTurn {
  turnIdx: number;
  role: string;
  timestamp: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number;
  toolsJson: string;
  stopReason: string;
}

export interface BenchRun {
  id: string;
  taskId: string;
  variant: BenchVariant;
  model: string;
  sourceJsonl: string;
  sessionId: string;
  startedAt: number;
  endedAt: number;
  wallMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number;
  turnCount: number;
  stopReason: string;
  toolCallsJson: string;
  success: number | null;
  notes: string | null;
  checksum: string;
  provenanceAuthor: string | null;
  provenanceCommit: string | null;
  importedFrom: string | null;
  createdAt: number;
  turns: BenchTurn[];
}

export interface BenchImport {
  id: string;
  importedAt: number;
  sourceFile: string;
  author: string | null;
  commit: string | null;
  rowCount: number;
  checksum: string;
}

export interface IngestOptions {
  taskId: string;
  variant: BenchVariant;
  model?: string;
  notes?: string;
  success?: number;
  author?: string;
  commit?: string;
}
