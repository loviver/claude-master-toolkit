import type Database from 'better-sqlite3';
import { openDb } from '../indexer/db-raw.js';

// ── DB handle ──

export function openMemDb(): Database.Database {
  return openDb();
}

// ── Type re-exports ──

export type {
  MemoryType,
  MemoryScope,
  MemoryRow,
  SaveInput,
  UpdateInput,
  RecallInput,
  RecallRow,
  ContextInput,
  TraceInput,
  SuggestInput,
  SuggestHint,
  SessionStartInput,
  SessionEndInput,
  SessionSummaryInput,
  PassiveInput,
  MergeInput,
  StatsInput,
  StatsOut,
  VaultDump,
} from './types.js';

// ── CRUD operations ──

export { save, update, deleteById, mark, getById } from './crud.js';

// ── Search operations ──

export { recall, context, trace, suggest } from './search.js';

// ── Session lifecycle ──

export { sessionStart, sessionEnd, sessionSummary, passive, merge } from './session-helpers.js';

// ── Stats and export/import ──

export { stats, exportVault, importVault } from './stats.js';
