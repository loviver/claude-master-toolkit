import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { openDb } from "../shared/indexer/db-raw.js";
import { memHandlers } from "./mem-tools.js";
import type { MemoryType, MemoryScope } from "../shared/memories/v2.js";
// Legacy pandorica type aliases kept for backward-compat shim signatures
type PandoricaType =
  | 'bugfix' | 'decision' | 'architecture' | 'discovery'
  | 'pattern' | 'config' | 'preference' | 'session_summary';
type PandoricaScope = 'project' | 'personal';
import {
  findSymbol,
  getDeps,
  getCallers,
  understand,
  rawSlice,
  recordFinding,
  recallFindings,
  briefRead,
  briefValidate,
} from "../shared/indexer/queries.js";
import type {
  FindingType,
  RecallOpts,
  FindOpts,
} from "../shared/indexer/types.js";

function mapPandoricaType(t: PandoricaType): MemoryType {
  if (t === 'config' || t === 'discovery') return 'note';
  return t as MemoryType;
}

function withDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const db = openDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const PROJECT_PATH = (cwd?: string) =>
  cwd ?? process.env["CTK_PROJECT_PATH"] ?? process.cwd();

function readModelPreference(): string {
  const prefFile = join(
    homedir(),
    ".claude",
    "state",
    "claude-master-toolkit",
    "model-preference",
  );
  try {
    if (existsSync(prefFile)) return readFileSync(prefFile, "utf-8").trim();
  } catch {}
  return "inherit";
}

function readMainModel(): string {
  const settingsFile = join(homedir(), ".claude", "settings.json");
  try {
    if (existsSync(settingsFile)) {
      const s = JSON.parse(readFileSync(settingsFile, "utf-8"));
      return s.model ?? "haiku";
    }
  } catch {}
  return "haiku";
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(msg: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
    isError: true,
  };
}

export const handlers = {
  ctk_understand(args: { symbol: string; cwd?: string }) {
    return withDb((db) => {
      const result = understand(db, PROJECT_PATH(args.cwd), args.symbol);
      if (!result)
        return errorResult(
          `symbol '${args.symbol}' not found. Run ctk index build first.`,
        );
      return jsonResult(result);
    });
  },

  ctk_find(args: { name: string; kind?: string; exported?: boolean; cwd?: string }) {
    return withDb((db) => {
      const opts: FindOpts = { kind: args.kind, exported: args.exported };
      const matches = findSymbol(db, PROJECT_PATH(args.cwd), args.name, opts);
      return jsonResult({ matches });
    });
  },

  ctk_deps(args: { file: string; cwd?: string }) {
    return withDb((db) => jsonResult(getDeps(db, PROJECT_PATH(args.cwd), args.file)));
  },

  ctk_callers(args: { symbol: string; cwd?: string }) {
    return withDb((db) =>
      jsonResult(getCallers(db, PROJECT_PATH(args.cwd), args.symbol)),
    );
  },

  ctk_slice(args: { file: string; symbol: string }) {
    const content = rawSlice(args.file, args.symbol);
    if (content === null)
      return errorResult(
        `slice: symbol '${args.symbol}' not found in ${args.file}`,
      );
    return jsonResult({ file: args.file, symbol: args.symbol, content });
  },

  ctk_record(args: {
    type: FindingType;
    finding: string;
    symbol?: string;
    file?: string;
    confidence?: number;
    role?: string;
  }) {
    return withDb((db) => {
      const r = recordFinding(db, {
        type: args.type,
        finding: args.finding,
        symbol: args.symbol,
        file: args.file,
        confidence: args.confidence,
        agentRole: args.role,
      });
      return jsonResult({ recorded: true, id: r.id });
    });
  },

  ctk_recall(args: {
    type?: FindingType;
    symbol?: string;
    session?: string;
    sinceMs?: number;
  }) {
    return withDb((db) => {
      const opts: RecallOpts = {
        type: args.type,
        symbol: args.symbol,
        sessionId: args.session,
        sinceMs: args.sinceMs,
      };
      const findings = recallFindings(db, opts);
      return jsonResult({ findings, count: findings.length });
    });
  },

  ctk_brief_read(args: { id: string }) {
    return withDb((db) => {
      const b = briefRead(db, args.id);
      if (!b) return errorResult(`brief '${args.id}' not found`);
      return jsonResult(b);
    });
  },

  ctk_brief_validate(args: { id: string }) {
    return withDb((db) => jsonResult(briefValidate(db, args.id)));
  },

  ctk_model(args: { phase: string }) {
    const pref = readModelPreference();

    if (pref.startsWith("pinned:")) return jsonResult({ model: pref.slice(7) });

    const current = readMainModel();

    if (pref === "inherit") return jsonResult({ model: current, pref });

    if (pref === "auto") {
      const opusPhases = ["sdd-propose", "sdd-design", "orchestrator"];
      const haikiPhases = ["sdd-archive"];
      const model = opusPhases.includes(args.phase)
        ? "opus"
        : haikiPhases.includes(args.phase)
          ? "haiku"
          : "sonnet";
      return jsonResult({ model, pref, phase: args.phase });
    }

    if (["opus", "sonnet", "haiku"].includes(pref)) {
      return jsonResult({ model: pref, pref });
    }

    return jsonResult({ model: current, pref });
  },

  ctk_git_log(args: { count?: number; cwd?: string }) {
    const n = String(args.count ?? 10);
    const cwd = args.cwd ?? process.cwd();
    try {
      const result = execFileSync(
        "git",
        ["log", "--oneline", "--decorate", "-n", n],
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], cwd },
      );
      return jsonResult({ log: result.trim() });
    } catch {
      return errorResult("git-log: not a git repo or git not found");
    }
  },

  pandorica_save(args: {
    title: string;
    type: PandoricaType;
    content: string;
    scope?: PandoricaScope;
    topic_key?: string;
    project_path?: string;
    session_id?: string;
  }) {
    return memHandlers.mem_save({
      title: args.title,
      type: mapPandoricaType(args.type),
      what: args.content,
      scope: args.scope,
      topic_key: args.topic_key,
      project_path: args.project_path,
      session_id: args.session_id,
    });
  },

  pandorica_search(args: {
    query: string;
    limit?: number;
    type?: PandoricaType;
    scope?: PandoricaScope;
    project_path?: string;
  }) {
    return memHandlers.mem_recall({
      query: args.query,
      limit: args.limit,
      type: args.type ? mapPandoricaType(args.type) : undefined,
      scope: args.scope,
      project_path: args.project_path,
    });
  },

  pandorica_context(args: { project_path?: string; session_id?: string; limit?: number }) {
    return memHandlers.mem_context(args);
  },

  pandorica_get(args: { id: string }) {
    return memHandlers.mem_get(args);
  },

  pandorica_session_summary(args: {
    content: string;
    session_id?: string;
    project_path?: string;
    title?: string;
  }) {
    const sid = args.session_id ?? process.env["CLAUDE_SESSION_ID"] ?? randomSessionId();
    return memHandlers.mem_session({
      sub: 'summary',
      session_id: sid,
      content: args.content,
      project_path: args.project_path,
      title: args.title,
    });
  },

  pandorica_recent(args: { project_path?: string; limit?: number }) {
    return memHandlers.mem_trace({
      project_path: args.project_path ?? PROJECT_PATH(),
      limit: args.limit ?? 10,
    });
  },

  ...memHandlers,

  ctk_git_changed(args: { cwd?: string }) {
    const cwd = args.cwd ?? process.cwd();
    try {
      let base: string;
      try {
        base = execFileSync(
          "git",
          ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
          { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], cwd },
        )
          .trim()
          .replace("origin/", "");
      } catch {
        base = "main";
      }
      const result = execFileSync(
        "git",
        ["diff", "--stat", `${base}...HEAD`],
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], cwd },
      );
      return jsonResult({ base, diff: result.trim() });
    } catch {
      return errorResult("git-changed: not a git repo or no base branch");
    }
  },
};
