import { Project, ts, type SourceFile } from 'ts-morph';
import { existsSync, statSync } from 'fs';
import { basename, dirname, join, relative, resolve, sep } from 'path';
import { collectImports, collectSymbols, isTsFile, type IndexedSymbol } from './ts-indexer.js';
import { isIndexablePath, walkDir } from './source-walk.js';
import type { FileImport } from './types.js';

/**
 * TS/JS side of `ctk index build`, for any layout: a single project, a monorepo whose
 * packages each carry their own tsconfig (no root one), a solution-style tsconfig
 * (`files: []` + `references`), or no tsconfig at all.
 *
 * Every tsconfig.json / jsconfig.json in the tree becomes a ts-morph Project, plus the
 * configs they reference. Each file is owned by the closest config that includes it, so
 * nested configs never index it twice. A file no config governs (no config in its dir or
 * any parent) goes to one fallback project; a file a config governs but leaves out is
 * skipped, so `exclude` keeps working. Projects are built lazily, one at a time.
 */
export interface TsWorkspace {
  files: string[];
  tsconfigs: string[];
  warnings: string[];
  extract: (absPath: string) => IndexedSymbol[];
  imports: (absPath: string) => FileImport[];
}

const CONFIG_NAMES = new Set(['tsconfig.json', 'jsconfig.json']);
// Fallback files have no tsconfig to exclude generated bundles: cap them instead.
const LOOSE_MAX_BYTES = 1024 * 1024;
const LOOSE = '<loose>';

function referencedConfigs(configPath: string): string[] {
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  const refs: Array<{ path?: string }> = Array.isArray(config?.references) ? config.references : [];
  return refs
    .filter((r) => typeof r.path === 'string')
    .map((r) => resolve(dirname(configPath), r.path!))
    .map((p) => (existsSync(p) && statSync(p).isDirectory() ? join(p, 'tsconfig.json') : p));
}

/** Walked configs plus everything they reference, transitively. */
function discoverConfigs(absRoot: string): string[] {
  const queue = walkDir(absRoot, (f) => CONFIG_NAMES.has(basename(f)));
  const seen = new Set<string>();
  while (queue.length > 0) {
    const cfg = queue.shift()!;
    if (seen.has(cfg) || !existsSync(cfg)) continue;
    seen.add(cfg);
    queue.push(...referencedConfigs(cfg));
  }
  return [...seen].sort();
}

function isUnder(dir: string, file: string): boolean {
  return file.startsWith(dir + sep);
}

function isLooseCandidate(file: string): boolean {
  return !file.endsWith('.min.js') && statSync(file).size <= LOOSE_MAX_BYTES;
}

export function openTsWorkspace(projectPath: string): TsWorkspace {
  const absRoot = resolve(projectPath);
  const warnings: string[] = [];
  const configs: Array<{ config: string; dir: string; fileNames: string[] }> = [];

  // Ownership comes from include/exclude alone (no source parsed), so only the Project
  // being extracted is alive: one type-checker in memory, not one per package.
  for (const config of discoverConfigs(absRoot)) {
    const rel = relative(absRoot, config);
    try {
      const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) => {
          throw new Error(ts.flattenDiagnosticMessageText(d.messageText, ' '));
        },
      });
      if (!parsed) continue;
      for (const d of parsed.errors) {
        // "No inputs" is the expected shape of a solution-style config, not a problem.
        if (d.code !== 18003) warnings.push(`${rel}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
      }
      configs.push({ config, dir: dirname(config), fileNames: parsed.fileNames.map((f) => resolve(f)) });
    } catch (err) {
      warnings.push(`${rel}: not loaded (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // Closest config dir wins, so nested configs never index a file twice.
  const owner = new Map<string, string>();
  const ownerDir = new Map<string, string>();
  for (const c of configs) {
    ownerDir.set(c.config, c.dir);
    for (const file of c.fileNames) {
      if (!isTsFile(file) || !isIndexablePath(absRoot, file)) continue;
      const current = owner.get(file);
      const currentDir = current ? ownerDir.get(current)! : undefined;
      const closer = isUnder(c.dir, file)
        && (!currentDir || !isUnder(currentDir, file) || c.dir.length > currentDir.length);
      if (!current || closer) owner.set(file, c.config);
    }
  }

  const governed = (file: string) => configs.some((c) => isUnder(c.dir, file));
  const loose = walkDir(absRoot, (f) => isTsFile(f) && !owner.has(f) && !governed(f) && isLooseCandidate(f));
  for (const file of loose) owner.set(file, LOOSE);

  let active: { key: string; project: Project } | undefined;
  const projectFor = (key: string): Project => {
    if (active?.key === key) return active.project;
    active = undefined; // drop the previous Project before building the next one
    const project = key === LOOSE
      ? new Project({ compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve } })
      : new Project({
        tsConfigFilePath: key,
        // Resolve import graph so the type-checker can follow aliases to real
        // declarations — required for precise dep/caller edges (not name strings).
        skipFileDependencyResolution: false,
      });
    if (key === LOOSE) project.addSourceFilesAtPaths(loose);
    active = { key, project };
    return project;
  };

  const sourceFile = (absPath: string): SourceFile | undefined => {
    const key = owner.get(absPath);
    return key ? projectFor(key).getSourceFile(absPath) : undefined;
  };

  // Grouped by owner: extracting in this order builds each Project once.
  const order = [...configs.map((c) => c.config), LOOSE];
  const files = [...owner.keys()].sort((x, y) =>
    order.indexOf(owner.get(x)!) - order.indexOf(owner.get(y)!) || x.localeCompare(y));

  return {
    files,
    tsconfigs: configs.map((c) => c.config),
    warnings,
    extract: (absPath) => {
      const sf = sourceFile(absPath);
      return sf ? collectSymbols(sf, absRoot, absPath) : [];
    },
    imports: (absPath) => {
      const sf = sourceFile(absPath);
      return sf ? collectImports(sf) : [];
    },
  };
}
