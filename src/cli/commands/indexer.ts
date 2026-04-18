import { resolve, relative, join } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { output, outputError } from '../../shared/output.js';
import { openTsProject, type IndexedSymbol } from '../../shared/indexer/ts-indexer.js';
import { TreeSitterIndexer } from '../../shared/indexer/tree-sitter-indexer.js';
import { openDb } from '../../shared/indexer/db-raw.js';
import { findSymbol, getDeps, getCallers } from '../../shared/indexer/queries.js';

const IGNORE_DIRS = new Set([
  'node_modules', 'dist', '.git', 'target', '__pycache__',
  '.venv', 'venv', 'build', '.next', '.cache', 'vendor',
]);

function walkDir(root: string, match: (file: string) => boolean, out: string[] = []): string[] {
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(root, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walkDir(full, match, out);
    } else if (e.isFile() && match(full)) {
      out.push(full);
    }
  }
  return out;
}

function hashFile(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 16);
}

export async function indexBuildCommand(
  opts: { path?: string; force?: boolean },
): Promise<void> {
  const projectPath = resolve(opts.path ?? process.cwd());
  if (!existsSync(projectPath)) {
    outputError(`index build: path does not exist: ${projectPath}`);
  }

  const start = Date.now();
  const hasTsConfig = existsSync(`${projectPath}/tsconfig.json`);
  const ts = hasTsConfig ? openTsProject(projectPath) : { files: [] as string[], extract: (_: string) => [] as IndexedSymbol[] };
  const treeSitter = new TreeSitterIndexer();
  const nonTsFiles = walkDir(projectPath, (f) => treeSitter.canHandle(f));
  const files: string[] = [...ts.files, ...nonTsFiles];

  const extract = (absFile: string): IndexedSymbol[] => {
    if (treeSitter.canHandle(absFile)) {
      const content = readFileSync(absFile, 'utf-8');
      return treeSitter.extractFromFile(projectPath, absFile, content);
    }
    return ts.extract(absFile);
  };

  const db = openDb();

  if (opts.force) {
    db.prepare('DELETE FROM symbols WHERE project_path = ?').run(projectPath);
    db.prepare('DELETE FROM indexed_files WHERE project_path = ?').run(projectPath);
  }

  const selectHash = db.prepare(
    'SELECT hash FROM indexed_files WHERE project_path = ? AND file = ?',
  );
  const deleteFileSymbols = db.prepare(
    'DELETE FROM symbols WHERE project_path = ? AND file = ?',
  );
  const upsertFile = db.prepare(`
    INSERT INTO indexed_files (project_path, file, hash, indexed_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_path, file) DO UPDATE SET hash = excluded.hash, indexed_at = excluded.indexed_at
  `);
  const deleteFileEntry = db.prepare(
    'DELETE FROM indexed_files WHERE project_path = ? AND file = ?',
  );
  const insertSymbol = db.prepare(`
    INSERT OR IGNORE INTO symbols
      (project_path, file, symbol, kind, signature, summary, start_line, end_line,
       exported, deps, callers, tokens_estimate, content_hash, updated_at)
    VALUES
      (@projectPath, @file, @symbol, @kind, @signature, NULL, @startLine, @endLine,
       @exported, @deps, NULL, @tokensEstimate, @contentHash, @updatedAt)
  `);

  let reindexed = 0;
  let skipped = 0;
  let errored = 0;
  let dirty = false;
  const now = Date.now();

  const indexTx = db.transaction((absFile: string) => {
    const relFile = relative(projectPath, absFile);
    const fileHash = hashFile(absFile);
    const existing = selectHash.get(projectPath, relFile) as { hash: string } | undefined;

    if (!opts.force && existing && existing.hash === fileHash) {
      skipped++;
      return;
    }

    let syms: IndexedSymbol[];
    try {
      syms = extract(absFile);
    } catch {
      errored++;
      return;
    }

    deleteFileSymbols.run(projectPath, relFile);
    for (const s of syms) {
      insertSymbol.run({
        projectPath: s.projectPath,
        file: s.file,
        symbol: s.symbol,
        kind: s.kind,
        signature: s.signature,
        startLine: s.startLine,
        endLine: s.endLine,
        exported: s.exported ? 1 : 0,
        deps: JSON.stringify(s.deps),
        tokensEstimate: s.tokensEstimate,
        contentHash: s.contentHash,
        updatedAt: now,
      });
    }
    upsertFile.run(projectPath, relFile, fileHash, now);
    reindexed++;
    dirty = true;
  });

  for (const file of files) {
    indexTx(file);
  }

  // Detect deleted files
  const trackedRows = db
    .prepare('SELECT file FROM indexed_files WHERE project_path = ?')
    .all(projectPath) as { file: string }[];
  const presentSet = new Set(files.map((f) => relative(projectPath, f)));
  const deleteStaleTx = db.transaction(() => {
    for (const r of trackedRows) {
      if (!presentSet.has(r.file)) {
        deleteFileSymbols.run(projectPath, r.file);
        deleteFileEntry.run(projectPath, r.file);
        dirty = true;
      }
    }
  });
  deleteStaleTx();

  // Recompute callers only when dirty
  if (dirty) {
    const recomputeTx = db.transaction(() => {
      const allRows = db
        .prepare('SELECT symbol, deps FROM symbols WHERE project_path = ?')
        .all(projectPath) as { symbol: string; deps: string | null }[];

      const callerMap = new Map<string, Set<string>>();
      for (const r of allRows) {
        const deps: string[] = r.deps ? JSON.parse(r.deps) : [];
        for (const d of deps) {
          if (!callerMap.has(d)) callerMap.set(d, new Set());
          callerMap.get(d)!.add(r.symbol);
        }
      }

      db.prepare('UPDATE symbols SET callers = NULL WHERE project_path = ?').run(projectPath);
      const updateCallers = db.prepare(
        'UPDATE symbols SET callers = ? WHERE project_path = ? AND symbol = ?',
      );
      for (const [sym, callers] of callerMap.entries()) {
        updateCallers.run(JSON.stringify(Array.from(callers)), projectPath, sym);
      }
    });
    recomputeTx();
  }

  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  output({
    files: files.length,
    reindexed,
    skipped,
    errored,
    elapsedMs: Date.now() - start,
  });
  process.exit(0);
}

export function indexFindCommand(name: string, opts: { kind?: string; exported?: boolean }): void {
  const db = openDb();
  try {
    const matches = findSymbol(db, process.cwd(), name, opts);
    output({ matches });
  } finally {
    db.close();
    process.exit(0);
  }
}

export function indexDepsCommand(file: string): void {
  const db = openDb();
  try {
    const result = getDeps(db, process.cwd(), file);
    output(result);
  } finally {
    db.close();
    process.exit(0);
  }
}

export function indexCallersCommand(name: string): void {
  const db = openDb();
  try {
    const result = getCallers(db, process.cwd(), name);
    output(result);
  } finally {
    db.close();
    process.exit(0);
  }
}
