import { resolve, relative, join } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { output, outputError } from '../../shared/output.js';
import { openTsProject, type IndexedSymbol } from '../../shared/indexer/ts-indexer.js';
import { IndexErrors } from '../../shared/indexer/index-errors.js';
import type { FileImport } from '../../shared/indexer/types.js';
import { TreeSitterIndexer } from '../../shared/indexer/tree-sitter-indexer.js';
import { openDb } from '../../shared/indexer/db-raw.js';
import { findSymbol, getDeps, getCallers } from '../../shared/indexer/queries.js';
import { qualifyId, parseQualifiedId } from '../../shared/indexer/ids.js';

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
  const ts = hasTsConfig
    ? openTsProject(projectPath)
    : { files: [] as string[], extract: (_: string) => [] as IndexedSymbol[], imports: (_: string) => [] as FileImport[] };
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
  const extractImports = (absFile: string): FileImport[] =>
    treeSitter.canHandle(absFile) ? [] : ts.imports(absFile);

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
    INSERT INTO indexed_files (project_path, file, hash, indexed_at, imports)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_path, file) DO UPDATE SET hash = excluded.hash, indexed_at = excluded.indexed_at, imports = excluded.imports
  `);
  const deleteFileEntry = db.prepare(
    'DELETE FROM indexed_files WHERE project_path = ? AND file = ?',
  );
  const insertSymbol = db.prepare(`
    INSERT OR IGNORE INTO symbols
      (project_path, file, symbol, kind, signature, summary, start_line, end_line,
       exported, deps, callers, refs, dep_sites, tokens_estimate, content_hash, updated_at)
    VALUES
      (@projectPath, @file, @symbol, @kind, @signature, NULL, @startLine, @endLine,
       @exported, @deps, NULL, @refs, @depSites, @tokensEstimate, @contentHash, @updatedAt)
  `);

  let reindexed = 0;
  let skipped = 0;
  const errors = new IndexErrors(projectPath);
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
    } catch (err) {
      errors.add(absFile, err);
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
        refs: JSON.stringify(s.refs ?? []),
        depSites: s.depSites ? JSON.stringify(s.depSites) : null,
        tokensEstimate: s.tokensEstimate,
        contentHash: s.contentHash,
        updatedAt: now,
      });
    }
    let imports: FileImport[] = [];
    try {
      imports = extractImports(absFile);
    } catch {
      // imports are best-effort; symbols are already extracted
    }
    upsertFile.run(projectPath, relFile, fileHash, now, JSON.stringify(imports));
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

  // Recompute callers/referrers only when dirty. Edges are file-qualified (`file::symbol`)
  // so same-named symbols in different files don't collide.
  if (dirty) {
    const recomputeTx = db.transaction(() => {
      const allRows = db
        .prepare('SELECT symbol, file, deps, refs FROM symbols WHERE project_path = ?')
        .all(projectPath) as { symbol: string; file: string; deps: string | null; refs: string | null }[];

      // key = dep id (qualified `tfile::tname`, or bare for an unresolved call);
      // value = set of qualified caller ids that reference it.
      const callerMap = new Map<string, Set<string>>();
      // Same shape for non-call refs: target id → qualified ids that reference it.
      const referrerMap = new Map<string, Set<string>>();
      const addEdge = (map: Map<string, Set<string>>, target: string, from: string) => {
        if (!map.has(target)) map.set(target, new Set());
        map.get(target)!.add(from);
      };
      for (const r of allRows) {
        const callerId = qualifyId(r.file, r.symbol);
        const deps: string[] = r.deps ? JSON.parse(r.deps) : [];
        for (const d of deps) addEdge(callerMap, d, callerId);
        const refs: string[] = r.refs ? JSON.parse(r.refs) : [];
        for (const t of refs) addEdge(referrerMap, t, callerId);
      }

      db.prepare('UPDATE symbols SET callers = NULL WHERE project_path = ?').run(projectPath);
      const updateByFile = db.prepare(
        'UPDATE symbols SET callers = ? WHERE project_path = ? AND file = ? AND symbol = ?',
      );
      const updateByName = db.prepare(
        'UPDATE symbols SET callers = ? WHERE project_path = ? AND symbol = ?',
      );
      for (const [dep, callers] of callerMap.entries()) {
        const payload = JSON.stringify(Array.from(callers));
        const parsed = parseQualifiedId(dep);
        if (parsed) {
          updateByFile.run(payload, projectPath, parsed.file, parsed.symbol);
        } else {
          // Unresolved (bare) dep target — fuzzy write to every same-named symbol.
          updateByName.run(payload, projectPath, dep);
        }
      }

      db.prepare('UPDATE symbols SET referrers = NULL WHERE project_path = ?').run(projectPath);
      const updateReferrers = db.prepare(
        'UPDATE symbols SET referrers = ? WHERE project_path = ? AND file = ? AND symbol = ?',
      );
      for (const [target, from] of referrerMap.entries()) {
        const parsed = parseQualifiedId(target);
        if (parsed) updateReferrers.run(JSON.stringify(Array.from(from)), projectPath, parsed.file, parsed.symbol);
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
    errored: errors.count,
    // A failed file is absent from the index (callers/deps silently shrink): say which and why.
    ...(errors.count > 0 ? { errors: errors.report(), errorCauses: errors.byMessage() } : {}),
    elapsedMs: Date.now() - start,
  });
  process.exit(0);
}

export function indexFindCommand(name: string, opts: { kind?: string; exported?: boolean; file?: string }): void {
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

export function indexCallersCommand(
  name: string,
  opts: { file?: string; include?: 'calls' | 'refs' | 'all' } = {},
): void {
  const db = openDb();
  try {
    const result = getCallers(db, process.cwd(), name, { file: opts.file, include: opts.include });
    output(result);
  } finally {
    db.close();
    process.exit(0);
  }
}
