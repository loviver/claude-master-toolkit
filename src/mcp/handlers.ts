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
  projectIndexed,
  understand,
  rawSlice,
  recordFinding,
  recallFindings,
  briefRead,
  briefValidate,
  type FindOpts,
} from "../shared/indexer/queries.js";
import { repoMap } from "../shared/indexer/repo-map.js";
import type {
  FindingType,
  RecallOpts,
} from "../shared/indexer/types.js";

function mapPandoricaType(t: PandoricaType): MemoryType {
  if (t === 'config' || t === 'discovery') return 'note';
  return t as MemoryType;
}

// One connection per MCP process. Opening costs the pragmas + schema/version checks on
// every call; the server is long-lived, so it is paid once. Closed on shutdown (server.ts).
let sharedDb: ReturnType<typeof openDb> | null = null;
let lastOpen: { openMs: number; reused: boolean } | null = null;

function acquireDb(): ReturnType<typeof openDb> {
  if (sharedDb?.open) {
    lastOpen = { openMs: 0, reused: true };
    return sharedDb;
  }
  const t0 = performance.now();
  sharedDb = openDb();
  lastOpen = { openMs: performance.now() - t0, reused: false };
  return sharedDb;
}

export function closeSharedDb(): void {
  try {
    sharedDb?.close();
  } catch {
    // already closed / closing on exit — nothing to recover
  }
  sharedDb = null;
}

function withDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  return fn(acquireDb());
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function emitTrace(tool: string, t0: number, result: unknown): void {
  const total = performance.now() - t0;
  const open = lastOpen;
  const text = (result as { content?: Array<{ text?: string }> } | undefined)?.content?.[0]?.text ?? '';
  const line = {
    tool,
    ms: round1(total),
    ...(open ? { openMs: round1(open.openMs), reused: open.reused } : {}),
    queryMs: round1(total - (open?.openMs ?? 0)),
    bytes: Buffer.byteLength(text),
  };
  // stderr only: stdout carries the stdio protocol.
  process.stderr.write(`[ctk-mcp:trace] ${JSON.stringify(line)}\n`);
}

/** CTK_MCP_TRACE=1 → one stderr line per tool call. Checked per call; zero cost when off. */
function withTrace<T extends Record<string, (...args: any[]) => unknown>>(h: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(h)) {
    out[name] = (...args: unknown[]) => {
      if (!process.env['CTK_MCP_TRACE']) return fn(...args);
      lastOpen = null;
      const t0 = performance.now();
      const result = fn(...args);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).then((r) => {
          emitTrace(name, t0, r);
          return r;
        });
      }
      emitTrace(name, t0, result);
      return result;
    };
  }
  return out as T;
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

/**
 * Index-backed tools: an unindexed project (never built, or wiped by a schema bump) is an
 * error with the fix, never an empty answer the agent would read as "no callers".
 */
function withIndex<T>(
  cwd: string | undefined,
  fn: (db: ReturnType<typeof openDb>, project: string) => T,
): T | ReturnType<typeof errorResult> {
  const project = PROJECT_PATH(cwd);
  return withDb((db) =>
    projectIndexed(db, project)
      ? fn(db, project)
      : errorResult(`project not indexed (or index outdated): run ctk index build --path ${project}`),
  );
}

const rawHandlers = {
  ctk_understand(args: { symbol: string; file?: string; cwd?: string }) {
    return withIndex(args.cwd, (db, project) => {
      const result = understand(db, project, args.symbol, { file: args.file });
      if (!result) return errorResult(`symbol '${args.symbol}' not found in the index of ${project}`);
      return jsonResult(result);
    });
  },

  ctk_find(args: { name: string; kind?: string; exported?: boolean; file?: string; cwd?: string }) {
    return withIndex(args.cwd, (db, project) => {
      const opts: FindOpts = { kind: args.kind, exported: args.exported, file: args.file };
      return jsonResult({ matches: findSymbol(db, project, args.name, opts) });
    });
  },

  ctk_deps(args: { file: string; symbol?: string; cwd?: string }) {
    return withIndex(args.cwd, (db, project) =>
      jsonResult(getDeps(db, project, args.file, { symbol: args.symbol })),
    );
  },

  ctk_callers(args: { symbol: string; file?: string; include?: 'calls' | 'refs' | 'all'; cwd?: string }) {
    return withIndex(args.cwd, (db, project) =>
      jsonResult(getCallers(db, project, args.symbol, { file: args.file, include: args.include })),
    );
  },

  ctk_map(args: { focus?: string[]; budget?: number; cwd?: string }) {
    return withIndex(args.cwd, (db, project) =>
      jsonResult(repoMap(db, project, { focus: args.focus, budget: args.budget })),
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

export const handlers = withTrace(rawHandlers);
