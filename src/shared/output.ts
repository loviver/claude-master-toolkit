import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CliOutput } from "./types/index.js";
import { c, formatCostColored, formatTokensColored } from "./terminal.js";

const SETTINGS_FILE = join(homedir(), ".claude", "settings.json");

export function readMainModel(): string {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const settings = JSON.parse(readFileSync(SETTINGS_FILE, "utf-8"));
      return settings.model ?? "sonnet";
    }
  } catch {
    // Fall through
  }
  return "sonnet";
}

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function output<T>(data: T): void {
  if (jsonMode) {
    const result: CliOutput<T> = { ok: true, data };
    console.log(JSON.stringify(result));
  } else {
    if (typeof data === "string") {
      console.log(data);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

export function outputError(message: string): void {
  if (jsonMode) {
    const result: CliOutput = { ok: false, error: message };
    console.log(JSON.stringify(result));
  } else {
    console.error(`${c.error("✗")}  ${message}`);
  }
  process.exit(1);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatTokensWithColor(n: number): string {
  return formatTokensColored(n);
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export function formatCostWithColor(usd: number): string {
  return formatCostColored(usd);
}
