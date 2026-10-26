import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from 'fs';
import { join } from 'path';
import { CodexAdapter } from '../../shared/agents/codex.js';
import { ctkHome, ctkPaths } from '../../shared/paths/ctk-home-paths.js';
import { removeManagedBlock, upsertManagedBlock } from './merge-toml.js';
import { mergeJsonPatch, unmergeJsonPatch } from './merge-json.js';
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
const SANDBOX_BLOCK_ID = 'sandbox';

/**
 * Events ctk registers on Codex: only those whose payload AND output contract are verified
 * (captures + official hooks doc). Tool hooks match `Bash` only: apply_patch / MCP have no
 * captured payload and the subagent spawn message is encrypted, so there is nothing to act on.
 * PreCompact / SubagentStart / SubagentStop are deliberately not registered (no context
 * injection on PreCompact, persona is Claude-specific until Phase 8).
 */
const CODEX_HOOK_EVENTS: Array<{ event: string; matcher?: string; timeout: number }> = [
  { event: 'SessionStart', timeout: 10 },
  { event: 'UserPromptSubmit', timeout: 10 },
  { event: 'PreToolUse', matcher: 'Bash', timeout: 10 },
  { event: 'PostToolUse', matcher: 'Bash', timeout: 10 },
  { event: 'Stop', timeout: 10 },
  { event: 'SessionEnd', timeout: 3 }, // Codex caps SessionEnd at 3s
];

export function codexHooksPatch(pkgRoot: string): Record<string, unknown> {
  const runtime = join(pkgRoot, 'dist', 'hook.js');
  const hooks: Record<string, unknown[]> = {};
  for (const h of CODEX_HOOK_EVENTS) {
    hooks[h.event] = [
      {
        ...(h.matcher ? { matcher: h.matcher } : {}),
        hooks: [{ type: 'command', command: `node "${runtime}" ${h.event} --agent codex`, timeout: h.timeout }],
      },
    ];
  }
  return { hooks };
}
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

  // 1b. The workspace-write sandbox cannot create SQLite's -wal/-shm in ~/.ctk, so every `ctk`
  // command an agent runs fails with "unable to open database file". Grant exactly the ctk home.
  // A [sandbox_workspace_write] the user already owns is never touched: warn instead.
  const grant = `[sandbox_workspace_write]\nwritable_roots = [${JSON.stringify(ctkHome())}]\n`;
  try {
    const sb = upsertManagedBlock(config, SANDBOX_BLOCK_ID, grant, { backupDir });
    entries.push({ type: 'toml-block', file: config, id: SANDBOX_BLOCK_ID, createdFile: false });
    report.actions.push(sb.changed ? `sandbox may write to ${ctkHome()}` : `sandbox already allows ${ctkHome()}`);
  } catch {
    report.warnings.push(
      `config.toml already defines [sandbox_workspace_write]: add ${JSON.stringify(ctkHome())} to its writable_roots, ` +
        'or ctk commands fail inside the Codex sandbox (SQLITE_CANTOPEN)',
    );
  }

  // 2. Hooks: merged into hooks.json (user/capture entries kept). Trust lives in config.toml
  // under [hooks.state.*] and is created by Codex itself when the user approves via /hooks.
  const hooksFile = adapter.hooksConfigPath(ctx.home);
  const patch = codexHooksPatch(ctx.pkgRoot);
  // The package moved since the last install: drop the hooks we registered for the old path,
  // otherwise they stay behind as dead commands next to the new ones.
  for (const e of readManifest('codex')?.entries ?? []) {
    if (e.type === 'json-patch' && e.file === hooksFile && JSON.stringify(e.patch) !== JSON.stringify(patch)) {
      unmergeJsonPatch(e.file, e.patch);
    }
  }
  const h = mergeJsonPatch(hooksFile, patch, { backupDir });
  entries.push({ type: 'json-patch', file: hooksFile, patch, createdFile: h.created || prevCreated(hooksFile) });
  report.actions.push(h.changed ? 'hooks registered in hooks.json' : 'hooks already registered');
  report.actions.push('Open /hooks in Codex to review and trust the ctk hooks (they do not run until trusted)');

  if (!existsSync(join(ctx.pkgRoot, 'dist', 'hook.js'))) {
    report.warnings.push(`${join(ctx.pkgRoot, 'dist', 'hook.js')} not found: build the package (hooks are no-ops until it exists)`);
  }

  // 3. Skills (symlinks into the package; never replace something the user owns).
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

/** A re-install must remember that WE created hooks.json in the first place. */
function prevCreated(file: string): boolean {
  return (
    readManifest('codex')?.entries.some((e) => e.type === 'json-patch' && e.file === file && e.createdFile === true) ?? false
  );
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
    } else if (e.type === 'json-patch') {
      if (unmergeJsonPatch(e.file, e.patch)) report.actions.push(`removed ctk hooks from ${e.file}`);
      if (e.createdFile && existsSync(e.file) && isEmptyJson(e.file)) rmSync(e.file);
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

function isEmptyJson(file: string): boolean {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return Object.keys(v).length === 0;
  } catch {
    return false;
  }
}
