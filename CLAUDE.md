# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Token-efficient configuration layer for Claude Code: a Node.js CLI (`ctk`), a Fastify + SQLite API server, and a React (Vite) metrics dashboard. Parses Claude Code session JSONL files into a SQLite DB for cost/token analytics.

## Build & Dev Commands

```bash
# Full build (CLI + server + Vite SPA)
npm run build

# Build only CLI (outputs to dist/cli/)
npm run build:cli

# Dev mode (Vite dev server + tsx watch on server)
npm run dev

# Dev CLI only
npm run dev:cli

# Run tests
npm run test              # single run (vitest)
npm run test:watch        # watch mode

# Database
npm run db:generate       # drizzle-kit generate migrations
npm run db:migrate        # run migrations (tsx src/server/db/migrate.ts)

# Install/uninstall into ~/.claude/
./install.sh              # builds, migrates, symlinks into ~/.claude/, adds ctk to PATH
./uninstall.sh            # restores from backup
```

## Architecture

Three build targets sharing `src/shared/`:

- **CLI** (`src/cli/`) — Commander-based, compiled via `tsconfig.cli.json` → `dist/cli/`. Binary entry: `dist/cli/index.js` (exposed as `ctk`). Commands in `src/cli/commands/` (cost, dashboard, find, git, model, slice, test, tokens).
- **Server** (`src/server/`) — Fastify on port 3100, compiled via `tsconfig.server.json`. Routes in `src/server/routes/` (health, memories, sessions, stats). DB is SQLite via Drizzle ORM (`src/server/db/`).
- **Client** (`src/client/`) — React SPA built by Vite from `src/client/` → `dist/public/`. Vite root is `src/client/`, proxies `/api` to server in dev. Path alias: `@client` → `src/client/`.
- **Shared** (`src/shared/`) — JSONL parser, pricing table, types, output helpers. Included in both CLI and server builds.

### Database

SQLite via `better-sqlite3` + Drizzle ORM. Schema in `src/server/db/schema.ts`. Tables: `sessions`, `token_events`, `memories`, `sync_state`. The server parses Claude Code JSONL session files and syncs them incrementally (tracked by `sync_state.last_byte_offset`).

### Claude Code Integration Layer

Lives in `claude-dist/` — installed by symlinking into `~/.claude/`:

- `claude-dist/CLAUDE.md` — persona and behavioral rules (symlinked to `~/.claude/CLAUDE.md`)
- `claude-dist/settings.patch.json` — hook registrations, merged into `~/.claude/settings.json`
- `claude-dist/hooks/` — bash scripts for session-start and context-guardian warnings
- `claude-dist/skills/` — on-demand skill definitions (sdd-*, pandorica-protocol, delegate)
- `claude-dist/agents/` — sub-agent prompts (sdd-orchestrator)
- `bin/ctk` — Node.js CLI shim (runs dist/cli/cli/index.js or falls back to tsx)

### Key Design Decisions

- Single `bin/ctk` entry point (Node.js shim). Legacy bash version archived as `bin/.ctk-legacy`.
- Pricing is hardcoded in `src/shared/pricing.ts`. Update there when Anthropic changes prices.
- ESM throughout (`"type": "module"` in package.json).
- The global `CLAUDE.md` is kept intentionally slim (~87 lines). Heavy workflow prompts live in `claude-dist/agents/` and `claude-dist/skills/` and load on-demand.

## CTK Commands (Phase 0)

- `ctk init` — detect stack + test framework, write `.ctk/project-context.md` + `init.marker`, activate Strict TDD when supported, persist a reference memory in pandorica.
- `ctk skill-registry` — scan skill sources (`~/.claude/skills/`, `claude-dist/skills/`, project skills, conventions) and render `.ctk/skill-registry.md` (name | triggers | path | summary).
- `ctk plan <task>` — topological resolve of the component graph (pandorica / sdd / skills / persona / hooks / model-routing) without executing. Debug tool.
- `ctk orchestrate <task>` — run the pipeline (prepare → apply → rollback-on-failure) with streamed progress events. Gated by ODD risk tier: DIRECT short-circuits to inline.
- `ctk risk [--base <ref>] [--json]` — ADVISORY ODD risk score of the current branch (DIRECT|GUARDED|DELEGATE) measured off the AST index. MCP tool: `ctk_risk`.
- `ctk model <phase>` — resolve the sub-agent model for a phase. MANDATORY before any `Agent` tool call (or use `/delegate`).
- `ctk mem <save|recall|context|trace|get|delete|summary|stats|export|import|reindex>` — persistent memory vault (Pandorica) CLI. MCP tools: `mem_save` / `mem_recall` / `mem_context` / `mem_get` / `mem_trace` / `mem_session`.

## Hook enforcement (post Phase 0.4)

- **PreToolUse:Agent** — single responsibility: enforces the `/delegate` brief protocol (hint, or hard block under `CTK_HOOK_AGENT_STRICT=1`). Must stay here because it needs to DENY before the spawn.
- **SubagentStart** — injects `~/.claude/persona.md` + `.ctk/skill-registry.md` pointer into the SUB-AGENT's context. Toggles: `CTK_HOOK_PERSONA_INJECT=0`, `CTK_HOOK_REGISTRY_INJECT=0`. (Moved off `PreToolUse:Agent`, whose `additionalContext` targets the main thread, not the sub-agent.)
- **SubagentStop** — opt-in (`CTK_HOOK_SUBAGENT_NAG=1`, default OFF). Non-blocking reminder to consolidate findings after apply/implement agents finish.
- **UserPromptSubmit** — on `/sdd-*` prompts with no `.ctk/init.marker`, emits an init-required hint so `sdd-orchestrator` runs `sdd-init` first.
- **PreToolUse:Edit|Write|MultiEdit** — parses `.ctk/skill-registry.md` and emits `[ctk-skill-hint] load <name>` when the target `file_path` matches a skill trigger. Toggle: `CTK_HOOK_EDIT_SKILL_INJECT=0`.
- **SessionStart** — also runs the incremental reindex (same lock/toggle as PostToolUse) in ctk-active projects, so an index wiped by a schema bump heals before the first `ctk_*` query. Bash is the default hook runtime (TS only with `CTK_HOOKS=ts`): every hook change needs both.
- **PostToolUse:Edit|Write|MultiEdit** — incremental `ctk index build` after a source-file (`ts/tsx/js/jsx/mjs/cjs/py/go/rs`) edit in a ctk-active project (gated on `.ctk/init.marker`), so the AST index ODD reads never goes stale. Runs **detached in the background** (zero turn latency) under a non-blocking `flock` so rapid edits don't pile up parallel SQLite writers. Toggle: `CTK_HOOK_REINDEX=0`. Test seam: `CTK_REINDEX_SYNC=1` runs inline.
- **SessionEnd** — mechanical final sync + per-session state cleanup on clear/logout.
- **Stop** — threshold configurable via `CTK_HOOK_SAVE_THRESHOLD` (default 3). `CTK_HOOK_SAVE_STRICT=1` blocks the turn (exit 2) when Edits ≥ threshold and zero `mem_save` / `ctk_record` calls.
- **Max-step cap** — `src/cli/lib/agent-budget.ts` tracks per-agent tool-call counters under `~/.claude/state/claude-master-toolkit/<session>/agent-steps/`. Default 10, override `CTK_AGENT_MAX_STEPS`. Soft enforcement via orchestrator prompt (hook-level hard enforcement blocked by Claude Code granularity).

## AgentAdapter (Phase 0.5)

`src/cli/agents/` defines an agent-agnostic interface. `ClaudeCodeAdapter` is full; `OpenCodeAdapter` / `CursorAdapter` / `CodexAdapter` are stubs that satisfy the interface but throw on install/path calls. Use `getAdapter('claude-code')` to resolve paths instead of hard-coding `~/.claude/*` in new code.
