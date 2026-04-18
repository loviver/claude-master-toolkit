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
