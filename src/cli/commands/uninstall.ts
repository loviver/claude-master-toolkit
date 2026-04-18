import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");

function say(msg: string) {
  console.log("  " + msg);
}

function head(msg: string) {
  console.log("\n== " + msg + " ==\n");
}

function removeSymlink(p: string): boolean {
  const stat = fs.lstatSync(p, { throwIfNoEntry: false });
  if (stat && stat.isSymbolicLink()) {
    fs.unlinkSync(p);
    return true;
  }
  return false;
}

export async function uninstallClaudeCommand(opts: any) {
  head("1. Remove symlinks");
  const topLinks = [
    path.join(CLAUDE_DIR, "CLAUDE.md"),
    path.join(CLAUDE_DIR, "skills", "sdd-new"),
    path.join(CLAUDE_DIR, "skills", "sdd-ff"),
    path.join(CLAUDE_DIR, "skills", "sdd-continue"),
    path.join(CLAUDE_DIR, "skills", "pandorica-protocol"),
    path.join(CLAUDE_DIR, "skills", "delegate"),
    path.join(CLAUDE_DIR, "skills", "ctk-toolkit"),
    path.join(CLAUDE_DIR, "agents", "sdd-orchestrator.md"),
  ];
  let removed = 0;
  for (const link of topLinks) if (removeSymlink(link)) removed++;

  // Recursively remove hook symlinks under ~/.claude/hooks/ that point into
  // the claude-master-toolkit repo. Leaves third-party hooks untouched.
  const hooksDir = path.join(CLAUDE_DIR, "hooks");
  const purgeCtkHooks = (dir: string): number => {
    if (!fs.existsSync(dir)) return 0;
    let n = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        n += purgeCtkHooks(p);
        try {
          if (fs.readdirSync(p).length === 0) fs.rmdirSync(p);
        } catch {}
      } else if (entry.isSymbolicLink()) {
        let target = "";
        try { target = fs.readlinkSync(p); } catch {}
        if (target.includes("claude-master-toolkit") || target.includes("claude-dist/hooks")) {
          fs.unlinkSync(p);
          n++;
        }
      }
    }
    return n;
  };
  removed += purgeCtkHooks(hooksDir);
  say(`removed symlinks (${removed})`);

  head("2. Clean state");
  const stateDir = path.join(CLAUDE_DIR, "state", "claude-master-toolkit");
  if (fs.existsSync(stateDir)) {
    for (const f of ["ctk.sqlite", "ctk.sqlite-journal", "model-preference"]) {
      const p = path.join(stateDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    say("cleaned state dir");
  } else {
    say("no state dir found");
  }

  head("3. Restore latest backup");
  const backupsDir = path.join(CLAUDE_DIR, "backups");
  if (fs.existsSync(backupsDir)) {
    const candidates = fs
      .readdirSync(backupsDir)
      .filter((n: string) => n.startsWith("cmt-"))
      .sort();
    const latest = candidates[candidates.length - 1];
    if (latest) {
      const dir = path.join(backupsDir, latest);
      for (const f of ["CLAUDE.md", "settings.json"]) {
        const src = path.join(dir, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(CLAUDE_DIR, f));
          say(`restored ${f}`);
        }
      }
    } else {
      say("no backup found");
    }
  } else {
    say("no backups dir");
  }

  head("4. Caveman plugin");
  if (opts.removeCaveman) {
    try {
      execSync("command -v claude", { stdio: "ignore" });
      try {
        execSync("claude plugin uninstall caveman@caveman", { stdio: "ignore" });
        say("caveman uninstalled");
      } catch {
        say("caveman not installed or failed");
      }
    } catch {
      say("claude CLI not found");
    }
  } else {
    say("kept (use --remove-caveman to remove)");
  }

  head("✓ Claude stack removed");
  console.log(`
Backups: ${path.join(CLAUDE_DIR, "backups")}
Reinstall: ctk install claude
`);
}
