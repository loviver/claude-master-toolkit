import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from 'fs';
import { join } from 'path';
import { CodexAdapter } from '../../shared/agents/codex.js';
import { ctkPaths } from '../../shared/paths/ctk-home-paths.js';
import { removeManagedBlock, upsertManagedBlock } from './merge-toml.js';
import { deleteManifest, readManifest, writeManifest, type ManifestEntry } from './manifest.js';

export interface InstallCtx {
  home: string;
  pkgRoot: string;
}

export interface InstallReport {
  actions: string[];
  warnings: string[];
}

/**
 * Skills with no Claude-specific paths/tools. delegate and sdd-* still mention ~/.claude and the
 * Agent tool; they ship to Codex in Phase 8 once the content is neutral (guarded by a test).
 */
export const CODEX_SKILLS = ['pandorica-protocol', 'ctk-toolkit', 'plan-designer'] as const;

const MCP_BLOCK_ID = 'mcp';
const adapter = new CodexAdapter();

const mcpBody = (pkgRoot: string) =>
  `[mcp_servers.ctk]\ncommand = "node"\nargs = [${JSON.stringify(join(pkgRoot, 'dist', 'mcp.js'))}]\n`;

export function installCodex(ctx: InstallCtx): InstallReport {
  const codexDir = adapter.globalConfigDir(ctx.home);
  if (!existsSync(codexDir)) throw new Error('~/.codex not found: is Codex CLI installed?');

  const report: InstallReport = { actions: [], warnings: [] };
  const entries: ManifestEntry[] = [];
  const backupDir = join(ctkPaths.backups(), 'codex');

  // 1. MCP (first: it can throw on a conflict, and nothing else should have changed by then).
  const config = adapter.settingsPath(ctx.home);
  const r = upsertManagedBlock(config, MCP_BLOCK_ID, mcpBody(ctx.pkgRoot), { backupDir });
  entries.push({ type: 'toml-block', file: config, id: MCP_BLOCK_ID, createdFile: r.created });
  report.actions.push(r.changed ? 'MCP ctk registered in config.toml' : 'MCP ctk already registered');

  // 2. Skills (symlinks into the package; never replace something the user owns).
  const skillsRoot = adapter.skillsDir(ctx.home);
  mkdirSync(skillsRoot, { recursive: true });
  for (const name of CODEX_SKILLS) {
    const target = join(ctx.pkgRoot, 'claude-dist', 'skills', name);
    const link = join(skillsRoot, name);
    const st = lstatSync(link, { throwIfNoEntry: false });
    if (st && !(st.isSymbolicLink() && readlinkSync(link) === target)) {
      if (!st.isSymbolicLink()) {
        report.warnings.push(`skill ${name}: ${link} already exists and is not ours, skipped`);
        continue;
      }
      unlinkSync(link); // stale ctk link (package moved): repoint
    }
    if (!st || st.isSymbolicLink()) {
      if (!lstatSync(link, { throwIfNoEntry: false })) symlinkSync(target, link, 'dir');
      entries.push({ type: 'symlink', path: link });
    }
  }
  report.actions.push(`skills linked (${entries.filter((e) => e.type === 'symlink').length}/${CODEX_SKILLS.length})`);

  writeManifest({ agent: 'codex', pkgRoot: ctx.pkgRoot, installedAt: new Date().toISOString(), entries });
  return report;
}

export function uninstallCodex(ctx: InstallCtx): InstallReport {
  const report: InstallReport = { actions: [], warnings: [] };
  const manifest = readManifest('codex');
  if (!manifest) {
    report.actions.push('nothing installed (no manifest)');
    return report;
  }

  for (const e of manifest.entries) {
    if (e.type === 'toml-block') {
      if (removeManagedBlock(e.file, e.id, { deleteIfEmpty: e.createdFile })) report.actions.push(`removed ${e.id} block`);
    } else if (e.type === 'symlink') {
      // Only remove what is still a symlink; if the user replaced it, it is theirs now.
      const st = lstatSync(e.path, { throwIfNoEntry: false });
      if (st?.isSymbolicLink()) {
        rmSync(e.path);
        report.actions.push(`removed ${e.path}`);
      } else if (st) report.warnings.push(`${e.path} is no longer a ctk symlink, left in place`);
    }
  }
  deleteManifest('codex');
  void ctx;
  return report;
}
