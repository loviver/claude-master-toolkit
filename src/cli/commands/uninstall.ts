import os from "os";
import { execSync } from "child_process";
import { uninstallClaude } from "../install/claude.js";
import { uninstallCodex } from "../install/codex.js";
import type { InstallReport } from "../install/codex.js";
import { readManifest } from "../install/manifest.js";

const say = (msg: string) => console.log("  " + msg);
const head = (msg: string) => console.log("\n== " + msg + " ==\n");

function print(report: InstallReport) {
  for (const a of report.actions) say(a);
  for (const w of report.warnings) say("⚠ " + w);
}

export async function uninstallClaudeCommand(opts: { removeCaveman?: boolean } = {}) {
  head("Claude Code");
  print(uninstallClaude({ home: os.homedir(), pkgRoot: readManifest("claude-code")?.pkgRoot ?? "" }));
  if (opts.removeCaveman) {
    try {
      execSync("claude plugin uninstall caveman@caveman", { stdio: "ignore" });
      say("caveman uninstalled");
    } catch {
      say("caveman not installed or claude CLI not found");
    }
  } else say("caveman kept (use --remove-caveman to remove)");
  head("✓ Claude stack removed (shared state in ~/.ctk untouched)");
}

export async function uninstallCodexCommand() {
  head("Codex");
  print(uninstallCodex({ home: os.homedir(), pkgRoot: readManifest("codex")?.pkgRoot ?? "" }));
  head("✓ Codex stack removed (shared state in ~/.ctk untouched)");
}

export async function uninstallAllCommand(opts: { removeCaveman?: boolean } = {}) {
  await uninstallClaudeCommand(opts);
  await uninstallCodexCommand();
}
