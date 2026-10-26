import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'fs';
import { basename, dirname, join } from 'path';
import { ctkPaths } from '../../shared/paths/ctk-home-paths.js';
import { backupFile } from './fs-util.js';
import { mergeJsonPatch, removeJsonKey, setJsonKey, unmergeJsonPatch } from './merge-json.js';
import { deleteManifest, readManifest, writeManifest, type ManifestEntry } from './manifest.js';
import type { InstallCtx, InstallReport } from './codex.js';

const AGENT = 'claude-code';

const paths = (ctx: InstallCtx) => ({
  claudeDir: join(ctx.home, '.claude'),
  dist: join(ctx.pkgRoot, 'claude-dist'),
  settings: join(ctx.home, '.claude', 'settings.json'),
  claudeJson: join(ctx.home, '.claude.json'),
  mcpJs: join(ctx.pkgRoot, 'dist', 'mcp.js'),
});

const lstat = (p: string) => lstatSync(p, { throwIfNoEntry: false });

function readPatch(dist: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dist, 'settings.patch.json'), 'utf8')) as Record<string, unknown>;
}

/** Idempotent symlink. Returns false (and warns) when the destination is something the user owns. */
function link(target: string, dest: string, type: 'file' | 'dir', report: InstallReport): boolean {
  const st = lstat(dest);
  if (!existsSync(target)) {
    if (st?.isSymbolicLink()) unlinkSync(dest); // a link to nothing helps no one
    report.warnings.push(`${basename(target)} is not in the package (${target}), skipped: reinstall ctk`);
    return false;
  }
  if (st) {
    if (!st.isSymbolicLink()) {
      report.warnings.push(`${dest} already exists and is not a symlink, skipped`);
      return false;
    }
    if (readlinkSync(dest) === target) return true;
    unlinkSync(dest); // stale ctk link (package moved): repoint
  }
  mkdirSync(dirname(dest), { recursive: true });
  symlinkSync(target, dest, type);
  return true;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

export function installClaude(ctx: InstallCtx): InstallReport {
  const p = paths(ctx);
  if (!existsSync(p.claudeDir)) throw new Error('~/.claude not found: is Claude Code installed?');
  if (!existsSync(p.dist)) throw new Error(`claude-dist not found at ${p.dist}: broken package?`);

  const report: InstallReport = { actions: [], warnings: [] };
  const entries: ManifestEntry[] = [];
  const backupDir = join(ctkPaths.backups(), AGENT);
  const prev = readManifest(AGENT);

  // CLAUDE.md: back up a real user file once; a re-install keeps the original restore entry.
  const claudeMd = join(p.claudeDir, 'CLAUDE.md');
  if (lstat(claudeMd) && !lstat(claudeMd)!.isSymbolicLink()) {
    const b = backupFile(claudeMd, backupDir);
    if (b) {
      entries.push({ type: 'restore', path: claudeMd, backup: b });
      rmSync(claudeMd);
    }
  }
  for (const e of prev?.entries ?? []) if (e.type === 'restore' && !entries.some((x) => x.type === 'restore' && x.path === e.path)) entries.push(e);

  const linked = (target: string, dest: string, type: 'file' | 'dir') => {
    if (link(target, dest, type, report)) entries.push({ type: 'symlink', path: dest });
  };

  linked(join(p.dist, 'CLAUDE.md'), claudeMd, 'file');
  linked(join(p.dist, 'persona.md'), join(p.claudeDir, 'persona.md'), 'file');
  for (const f of walkFiles(join(p.dist, 'hooks'))) {
    const rel = f.slice(join(p.dist, 'hooks').length + 1);
    linked(f, join(p.claudeDir, 'hooks', rel), 'file');
  }
  for (const s of readdirSync(join(p.dist, 'skills'), { withFileTypes: true })) {
    if (s.isDirectory()) linked(join(p.dist, 'skills', s.name), join(p.claudeDir, 'skills', s.name), 'dir');
  }
  for (const a of readdirSync(join(p.dist, 'agents'))) {
    if (a.endsWith('.md')) linked(join(p.dist, 'agents', a), join(p.claudeDir, 'agents', a), 'file');
  }
  report.actions.push(`linked ${entries.filter((e) => e.type === 'symlink').length} files (CLAUDE.md, persona, hooks, skills, agents)`);

  // settings.json: hooks + statusLine, merged (user hooks kept, ours added once).
  const patch = readPatch(p.dist);
  mergeJsonPatch(p.settings, patch, { backupDir });
  entries.push({ type: 'json-patch', file: p.settings, patch });
  report.actions.push('settings.json merged');

  // MCP lives in ~/.claude.json (created when absent; it used to crash install).
  const mcp = { command: 'node', args: [p.mcpJs] };
  setJsonKey(p.claudeJson, ['mcpServers', 'ctk'], mcp, { backupDir });
  entries.push({ type: 'json-key', file: p.claudeJson, keyPath: ['mcpServers', 'ctk'] });
  report.actions.push('MCP ctk registered in ~/.claude.json');

  const pref = ctkPaths.modelPref();
  if (!existsSync(pref)) {
    mkdirSync(dirname(pref), { recursive: true });
    writeFileSync(pref, 'inherit\n');
    report.actions.push('model preference -> inherit');
  }

  writeManifest({ agent: AGENT, pkgRoot: ctx.pkgRoot, installedAt: new Date().toISOString(), entries });
  return report;
}

/** Installs made before manifests existed: rebuild the entry list from symlinks that point into the package. */
function legacyEntries(ctx: InstallCtx): ManifestEntry[] {
  const p = paths(ctx);
  const entries: ManifestEntry[] = [];
  const ours = (f: string) => {
    try {
      return lstat(f)?.isSymbolicLink() === true && readlinkSync(f).includes('/claude-dist/');
    } catch {
      return false;
    }
  };
  const scan = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      if (ours(f)) entries.push({ type: 'symlink', path: f });
      else if (e.isDirectory()) scan(f);
    }
  };
  for (const f of ['CLAUDE.md', 'persona.md']) if (ours(join(p.claudeDir, f))) entries.push({ type: 'symlink', path: join(p.claudeDir, f) });
  for (const d of ['hooks', 'skills', 'agents']) scan(join(p.claudeDir, d));
  if (existsSync(join(p.dist, 'settings.patch.json'))) {
    entries.push({ type: 'json-patch', file: p.settings, patch: readPatch(p.dist) });
  }
  entries.push({ type: 'json-key', file: p.claudeJson, keyPath: ['mcpServers', 'ctk'] });
  return entries;
}

/** Removes dirs that became empty because we removed our link (never the category root, never user dirs). */
function pruneParents(file: string, stopAt: string): void {
  let dir = dirname(file);
  while (dir.startsWith(stopAt + '/') && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    dir = dirname(dir);
  }
}

/**
 * Removes exactly what install added (manifest). Touches nothing under ~/.ctk (the DB and
 * memories are shared with Codex) and nothing the user owns.
 */
export function uninstallClaude(ctx: InstallCtx): InstallReport {
  const p = paths(ctx);
  const report: InstallReport = { actions: [], warnings: [] };
  const manifest = readManifest(AGENT);
  const entries = manifest?.entries ?? legacyEntries(ctx);
  if (!manifest) report.actions.push('no manifest (older install): scanning for ctk symlinks');

  let removed = 0;
  for (const e of entries) {
    if (e.type === 'symlink' && lstat(e.path)?.isSymbolicLink()) {
      rmSync(e.path);
      removed++;
      pruneParents(e.path, join(p.claudeDir, e.path.slice(p.claudeDir.length + 1).split('/')[0]!));
    }
  }
  report.actions.push(`removed ${removed} symlinks`);
  for (const e of entries) {
    if (e.type === 'json-patch' && unmergeJsonPatch(e.file, e.patch)) report.actions.push(`removed ctk entries from ${e.file}`);
    else if (e.type === 'json-key' && removeJsonKey(e.file, e.keyPath)) report.actions.push(`removed ${e.keyPath.join('.')} from ${e.file}`);
    else if (e.type === 'restore' && !lstat(e.path) && existsSync(e.backup)) {
      copyFileSync(e.backup, e.path);
      report.actions.push(`restored ${e.path}`);
    }
  }
  deleteManifest(AGENT);
  return report;
}
