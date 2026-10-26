import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { currentSessionId, readMainModel, resolveAgentId } from "../shared/agents/resolve.js";
import { resolveModel } from "../shared/models/router.js";
import { openDb } from "../shared/indexer/db-raw.js";
import { ctkPaths } from "../shared/paths/ctk-home.js";
import { assessRisk } from "../shared/risk/index.js";
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
  type FindOpts,
} from "../shared/indexer/queries.js";
import type {
  FindingType,
  RecallOpts,
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
  const prefFile = ctkPaths.modelPref();
  try {
    if (existsSync(prefFile)) return readFileSync(prefFile, "utf-8").trim();
  } catch {}
  return "inherit";
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function errorResult(msg: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
    isError: true,
  };
}

export const handlers = {
  ctk_understand(args: { symbol: string; file?: string; cwd?: string }) {
    return withDb((db) => {
      const result = understand(db, PROJECT_PATH(args.cwd), args.symbol, { file: args.file });
      if (!result)
        return errorResult(
          `symbol '${args.symbol}' not found. If this project is not indexed yet, run: ctk index build --path ${PROJECT_PATH(args.cwd)}`,
        );
      return jsonResult(result);
    });
  },

  ctk_find(args: { name: string; kind?: string; exported?: boolean; file?: string; cwd?: string }) {
    return withDb((db) => {
      const opts: FindOpts = { kind: args.kind, exported: args.exported, file: args.file };
      const matches = findSymbol(db, PROJECT_PATH(args.cwd), args.name, opts);
      return jsonResult({ matches });
    });
  },

  ctk_deps(args: { file: string; cwd?: string }) {
    return withDb((db) => jsonResult(getDeps(db, PROJECT_PATH(args.cwd), args.file)));
  },

  ctk_callers(args: { symbol: string; file?: string; cwd?: string }) {
    return withDb((db) =>
      jsonResult(getCallers(db, PROJECT_PATH(args.cwd), args.symbol, { file: args.file })),
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

  ctk_risk(args: { base?: string; cwd?: string }) {
    try {
      return jsonResult(assessRisk({ base: args.base, cwd: PROJECT_PATH(args.cwd) }));
    } catch (err) {
      return errorResult(`ctk_risk failed: ${(err as Error).message}`);
    }
  },

  ctk_model(args: { phase: string; agent?: string }) {
    const pref = readModelPreference();
    let agent;
    try {
      agent = resolveAgentId(args.agent);
    } catch (err) {
      return errorResult((err as Error).message);
    }
    const model = resolveModel({ agent, current: readMainModel(agent), pref, phase: args.phase });
    return jsonResult({ model, pref, phase: args.phase, agent });
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
    const sid = args.session_id ?? currentSessionId() ?? randomUUID();
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
