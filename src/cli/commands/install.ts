import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, "..");
const CLAUDE_DIST = path.join(PKG_ROOT, "claude-dist");
const CLAUDE_DIR = path.join(os.homedir(), ".claude");

function say(msg: string) {
  console.log("  " + msg);
}

function head(msg: string) {
  console.log("\n== " + msg + " ==\n");
}

function die(msg: string) {
  console.error("✗ " + msg);
  process.exit(1);
  throw new Error(msg);
}

function linkForce(target: string, link: string, type: "file" | "dir") {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  const stat = fs.lstatSync(link, { throwIfNoEntry: false });
  if (stat) fs.unlinkSync(link);
  fs.symlinkSync(target, link, type);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(...sources: Record<string, any>[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const src of sources) {
    if (!isPlainObject(src)) continue;
    for (const [k, v] of Object.entries(src)) {
      if (isPlainObject(v) && isPlainObject(out[k])) {
        out[k] = deepMerge(out[k], v);
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}

function findCtkBinariesOnPath(): string[] {
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const found = new Set<string>();
  for (const dir of pathDirs) {
    const candidate = path.join(dir, "ctk");
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink() || stat.isFile()) {
        found.add(fs.realpathSync(candidate));
      }
    } catch {}
  }
  return [...found];
}

function warnOnConflict(pkgRoot: string) {
  const bins = findCtkBinariesOnPath();
  if (bins.length <= 1) return;
  const pkgRootReal = fs.realpathSync(pkgRoot);
  const mismatched = bins.filter((b) => !b.startsWith(pkgRootReal));
  if (mismatched.length === 0) return;
  console.warn(`\n⚠  Multiple ctk binaries on PATH resolve to different packages:`);
  for (const b of bins) console.warn(`     ${b}`);
  console.warn(`   This install will use: ${pkgRootReal}`);
  console.warn(`   Remove the duplicates or run 'npm link' from the repo you want to use.\n`);
}

export async function installClaudeCommand(opts: any) {
  head("0. Resolve package");
  say(`Package root: ${PKG_ROOT}`);
  warnOnConflict(PKG_ROOT);

  if (!fs.existsSync(CLAUDE_DIR)) {
    die("~/.claude not found — is Claude Code installed?");
  }
  if (!fs.existsSync(CLAUDE_DIST)) {
    die(`claude-dist not found at ${CLAUDE_DIST} — broken package?`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(CLAUDE_DIR, "backups", `cmt-${timestamp}`);

  head("1. Backup existing config");
  fs.mkdirSync(backupDir, { recursive: true });

  const claudeMdPath = path.join(CLAUDE_DIR, "CLAUDE.md");
  if (fs.existsSync(claudeMdPath) && !fs.lstatSync(claudeMdPath).isSymbolicLink()) {
    fs.copyFileSync(claudeMdPath, path.join(backupDir, "CLAUDE.md"));
    say("backed up CLAUDE.md");
  }

  const settingsPath = path.join(CLAUDE_DIR, "settings.json");
  if (fs.existsSync(settingsPath)) {
    fs.copyFileSync(settingsPath, path.join(backupDir, "settings.json"));
    say("backed up settings.json");
  }
  fs.writeFileSync(path.join(backupDir, "pkg-root"), PKG_ROOT);

  head("2. Symlink CLAUDE.md + hooks");
  linkForce(path.join(CLAUDE_DIST, "CLAUDE.md"), claudeMdPath, "file");

  // Mirror every file under claude-dist/hooks/ (including subdirs) as symlinks.
  // This keeps the user's ~/.claude/hooks/ extensible with third-party hooks.
  const mirrorHooks = (srcRoot: string, dstRoot: string) => {
    let count = 0;
    const walk = (srcDir: string, dstDir: string) => {
      fs.mkdirSync(dstDir, { recursive: true });
      for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const srcPath = path.join(srcDir, entry.name);
        const dstPath = path.join(dstDir, entry.name);
        if (entry.isDirectory()) {
          walk(srcPath, dstPath);
        } else if (entry.isFile()) {
          if (srcPath.endsWith(".sh")) {
            try { fs.chmodSync(srcPath, 0o755); } catch {}
          }
          linkForce(srcPath, dstPath, "file");
          count++;
        }
      }
    };
    walk(srcRoot, dstRoot);
    return count;
  };

  const hookCount = mirrorHooks(
    path.join(CLAUDE_DIST, "hooks"),
    path.join(CLAUDE_DIR, "hooks"),
  );
  say(`linked CLAUDE.md + hooks (${hookCount})`);

  head("3. Symlink skills + agents");
  const skills = ["sdd-new", "sdd-ff", "sdd-continue", "pandorica-protocol", "delegate", "ctk-toolkit"];
  for (const skill of skills) {
    linkForce(
      path.join(CLAUDE_DIST, "skills", skill),
      path.join(CLAUDE_DIR, "skills", skill),
      "dir",
    );
  }
  const agents = [
    "sdd-orchestrator",
    "sdd-init",
    "sdd-onboard",
    "sdd-explore",
    "sdd-propose",
    "sdd-spec",
    "sdd-design",
    "sdd-tasks",
    "sdd-apply",
    "sdd-verify",
    "sdd-archive",
  ];
  for (const agent of agents) {
    linkForce(
      path.join(CLAUDE_DIST, "agents", `${agent}.md`),
      path.join(CLAUDE_DIR, "agents", `${agent}.md`),
      "file",
    );
  }
  linkForce(
    path.join(CLAUDE_DIST, "persona.md"),
    path.join(CLAUDE_DIR, "persona.md"),
    "file",
  );
  say(`linked skills (${skills.length}) + agents (${agents.length}) + persona`);

  head("4. Merge settings.json");
  const patchPath = path.join(CLAUDE_DIST, "settings.patch.json");

  let base: Record<string, any> = {};
  if (fs.existsSync(settingsPath)) {
    base = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  }
  const patch = JSON.parse(fs.readFileSync(patchPath, "utf-8"));

  const mcpServerPath = path.join(PKG_ROOT, "dist", "mcp.js");
  const mcpPatch = {
    mcpServers: {
      ctk: {
        command: "node",
        args: [mcpServerPath],
      },
    },
  };

  const merged = deepMerge(base, patch, mcpPatch);
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
  say(`settings merged (mcp: ${mcpServerPath})`);

  head("5. Model preference");
  const stateDir = path.join(CLAUDE_DIR, "state", "claude-master-toolkit");
  fs.mkdirSync(stateDir, { recursive: true });
  const prefFile = path.join(stateDir, "model-preference");
  if (!fs.existsSync(prefFile)) {
    fs.writeFileSync(prefFile, "inherit\n");
    say("model preference → inherit");
  } else {
    say("model preference: " + fs.readFileSync(prefFile, "utf-8").trim());
  }

  head("6. Caveman plugin");
  if (opts.skipCaveman) {
    say("skipped (--skip-caveman)");
  } else {
    try {
      execSync("command -v claude", { stdio: "ignore" });
      try {
        execSync("claude plugin marketplace add JuliusBrussee/caveman", { stdio: "ignore" });
        execSync("claude plugin install caveman@caveman", { stdio: "ignore" });
        say("caveman plugin configured");
      } catch {
        say("caveman install skipped (already installed or failed)");
      }
    } catch {
      say("caveman skipped (claude CLI not found)");
    }
  }

  head("✓ Claude stack installed");
  console.log(`
Package: ${PKG_ROOT}
Backup:  ${backupDir}
Config:  ~/.claude (symlinked)

To remove: ctk uninstall claude
`);
}
