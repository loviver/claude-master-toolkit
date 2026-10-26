import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { installClaude } from "../install/claude.js";
import { installCodex, type InstallReport } from "../install/codex.js";

function findPackageRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    current = path.dirname(current);
  }
  throw new Error("package.json not found — cannot resolve PKG_ROOT");
}

const say = (msg: string) => console.log("  " + msg);
const head = (msg: string) => console.log("\n== " + msg + " ==\n");

function die(msg: string): never {
  console.error("✗ " + msg);
  process.exit(1);
}

function findCtkBinariesOnPath(): string[] {
  const found = new Set<string>();
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, "ctk");
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink() || stat.isFile()) found.add(fs.realpathSync(candidate));
    } catch {}
  }
  return [...found];
}

function warnOnConflict(pkgRoot: string) {
  const bins = findCtkBinariesOnPath();
  if (bins.length <= 1) return;
  const pkgRootReal = fs.realpathSync(pkgRoot);
  if (bins.every((b) => b.startsWith(pkgRootReal))) return;
  console.warn(`\n⚠  Multiple ctk binaries on PATH resolve to different packages:`);
  for (const b of bins) console.warn(`     ${b}`);
  console.warn(`   This install will use: ${pkgRootReal}`);
  console.warn(`   Remove the duplicates or run 'npm link' from the repo you want to use.\n`);
}

function print(report: InstallReport) {
  for (const a of report.actions) say(a);
  for (const w of report.warnings) say("⚠ " + w);
}

function installCaveman() {
  head("Caveman plugin");
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

export async function installClaudeCommand(opts: { skipCaveman?: boolean } = {}) {
  const pkgRoot = findPackageRoot();
  head("Claude Code");
  say(`Package root: ${pkgRoot}`);
  warnOnConflict(pkgRoot);
  try {
    print(installClaude({ home: os.homedir(), pkgRoot }));
  } catch (e) {
    die((e as Error).message);
  }
  if (!opts.skipCaveman) installCaveman();
  head("✓ Claude stack installed (undo: ctk uninstall claude)");
}

export async function installCodexCommand() {
  const pkgRoot = findPackageRoot();
  head("Codex");
  say(`Package root: ${pkgRoot}`);
  try {
    print(installCodex({ home: os.homedir(), pkgRoot }));
  } catch (e) {
    die((e as Error).message);
  }
  head("✓ Codex stack installed (undo: ctk uninstall codex)");
  console.log(
    "  Hooks, agents and AGENTS.md for Codex arrive in later phases; MCP + neutral skills are active now.\n",
  );
}

/** Installs every agent whose config dir exists; skips (with a note) the ones that are not installed. */
export async function installAllCommand(opts: { skipCaveman?: boolean } = {}) {
  const home = os.homedir();
  const targets: Array<[string, string, () => Promise<void>]> = [
    ["claude", ".claude", () => installClaudeCommand(opts)],
    ["codex", ".codex", () => installCodexCommand()],
  ];
  let ran = 0;
  for (const [name, dir, run] of targets) {
    if (fs.existsSync(path.join(home, dir))) {
      await run();
      ran++;
    } else say(`${name}: ~/${dir} not found, skipped`);
  }
  if (ran === 0) die("no supported agent found (~/.claude or ~/.codex)");
}
