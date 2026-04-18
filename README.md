# claude-master-toolkit

**An operation layer for [Claude Code](https://claude.ai/code).**

`ctk` is a CLI and local dashboard that turns Claude Code's session JSONL files into something you can actually measure, search, and control — cost telemetry, context‑window warnings, persistent memory, model routing, and a web dashboard. All local, all offline, opt‑in per feature.

```bash
npm install -g claude-master-toolkit
ctk dashboard          # http://localhost:3200
```

> This is not a replacement for Claude Code. It's a layer on top of it. You still need `claude` installed and logged in.

---

## What's actually in the box

| Component              | What it does                                                                                                 | Where it lives                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **Dashboard**          | React SPA + Fastify server on `:3200`. Shows sessions, token events, costs, memories.                        | `ctk dashboard`                           |
| **Cost telemetry**     | Parses `~/.claude/projects/**/*.jsonl` into SQLite. Real API‑charged counts, not heuristics.                 | `ctk cost`, `ctk context`, dashboard      |
| **Context guardian**   | Hooks that warn when you cross 70 / 85 / 95 % of the window — before Claude Code does.                       | installed by `ctk install claude`         |
| **Pandorica**          | Persistent memory vault (SQLite). Save decisions/bugs/patterns, search across sessions and projects.         | `ctk pandorica …`, MCP tools              |
| **Model router**       | `ctk model <phase>` returns an alias (opus/sonnet/haiku) per SDD phase. Sub‑agents inherit it via `/delegate`. | `ctk model`, `ctk model-pref`             |
| **Code indexer**       | Tree‑sitter + ts‑morph symbol index for TS, Go, Python, Rust. Find / callers / deps in JSON.                 | `ctk index …`, `ctk understand`           |
| **MCP server**         | Exposes Pandorica + indexer as MCP tools so Claude Code can call them directly.                              | registered on `ctk install claude`        |
| **Bench harness**      | A/B runs (ctk vs baseline) from JSONL with export/import of the bench DB.                                    | `ctk bench …`                             |
| **Bash primitives**    | `slice`, `find`, `git-log`, `git-changed`, `test-summary` — compact output for agent loops.                  | `ctk <cmd>`                               |

Everything writes to `~/.claude/state/claude-master-toolkit/` and `~/.claude/projects/` (read‑only). Nothing phones home.

---

## Two ways to use it

### 1 · Standalone — just the dashboard and CLI

```bash
npm install -g claude-master-toolkit
ctk dashboard
```

This does **not** touch your Claude Code config. It reads session JSONL, writes its own SQLite under `~/.claude/state/claude-master-toolkit/`, and exposes a dashboard + CLI. Uninstall with `npm uninstall -g claude-master-toolkit`.

### 2 · Integrated — hooks, skills, MCP, persona

```bash
ctk install claude
```

This **modifies your Claude Code environment** (with a timestamped backup at `~/.claude/backups/cmt-<ts>/`):

- Symlinks an opinionated `CLAUDE.md` persona into `~/.claude/CLAUDE.md`
- Symlinks skills (`sdd-new`, `sdd-ff`, `sdd-continue`, `pandorica-protocol`, `delegate`, `ctk-toolkit`) and the `sdd-orchestrator` agent into `~/.claude/`
- Installs hooks (`session-start`, `user-prompt-submit`, `pre-tool-use`, `stop`, `pre-compact`) into `~/.claude/hooks/`
- Merges hook + MCP registrations into `~/.claude/settings.json`
- Optionally installs the third‑party `caveman` plugin (skip with `--skip-caveman`)

Revert anytime with `ctk uninstall claude` (restores the latest backup).

**Read the persona before installing.** It's a "senior architect / passionate teacher" opinionated persona. If you don't want it, use standalone mode.

---

## CLI reference

All commands accept `--json` for machine‑readable output.

### Telemetry

| Command              | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `ctk cost [--quiet]` | Realized cost of the current Claude Code session (JSONL → pricing table).     |
| `ctk context`        | Window usage %, cumulative tokens, model, cost, threshold advice.             |
| `ctk tokens [file]`  | Rough token count for file / stdin (`chars / 4`).                             |
| `ctk estimate <f>`   | Faithful pre‑flight count via Anthropic `count_tokens` (needs `ANTHROPIC_API_KEY`). |

### Search & code navigation

| Command                      | Purpose                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `ctk find <query> [path]`    | Ranked ripgrep, top 20.                                       |
| `ctk slice <file> <symbol>`  | Extract one function / class / type (ts‑morph).               |
| `ctk index build`            | Build a semantic symbol index for the current project.        |
| `ctk index find <symbol>`    | Locate a symbol (filter by kind / exported).                  |
| `ctk index deps <file>`      | Imports + exports of a file.                                  |
| `ctk index callers <symbol>` | Who calls this symbol.                                        |
| `ctk understand <symbol>`    | `find` + `slice` + `deps` + `callers` in one JSON payload.    |

### Git & tests

| Command                        | Purpose                                               |
| ------------------------------ | ----------------------------------------------------- |
| `ctk git-log [N]`              | One‑line log for last N commits (default 10).         |
| `ctk git-changed`              | Files changed vs `main`, with line counts.            |
| `ctk test-summary [cmd...]`    | Run command, print pass/fail summary only.            |

### Model routing

| Command                                       | Purpose                                              |
| --------------------------------------------- | ---------------------------------------------------- |
| `ctk model <phase>`                           | Print the alias for a phase (respects preference).   |
| `ctk model-pref get`                          | Show current preference.                             |
| `ctk model-pref set <inherit\|auto\|opus\|sonnet\|haiku\|pinned:...>` | Update preference.      |
| `ctk model-pref clear`                        | Reset to default (`inherit`).                        |

### Pandorica (persistent memory)

| Command                               | Purpose                                                   |
| ------------------------------------- | --------------------------------------------------------- |
| `ctk pandorica save --title ... --type ...` | Save a memory (`bugfix`, `decision`, `architecture`, `discovery`, `pattern`, `config`, `preference`, `session_summary`). |
| `ctk pandorica search <q>`            | Keyword search.                                           |
| `ctk pandorica context`               | Recent memories for current project/session.              |
| `ctk pandorica recent [--all]`        | Last N memories.                                          |
| `ctk pandorica get <id>`              | Full untruncated memory.                                  |
| `ctk pandorica delete <id>`           | Delete a memory.                                          |
| `ctk pandorica summary`               | Persist a session summary.                                |

### Briefs & findings (sub‑agent coordination)

`ctk brief new|read|validate|freeze` for strict sub‑agent task contracts. `ctk record` / `ctk recall` for a shared findings pool across agents.

### Bench

`ctk bench task add|list|remove`, `ctk bench ingest|list|show|compare`, `ctk bench export|import` for A/B comparisons of ctk vs baseline runs.

### Dashboard

| Command                   | Purpose                                         |
| ------------------------- | ----------------------------------------------- |
| `ctk dashboard`           | Start server on `:3200` and open browser.       |
| `ctk dashboard -p 4000`   | Custom port.                                    |
| `ctk dashboard --no-open` | Don't auto‑open the browser.                    |

---

## Cost accuracy

Three fidelity sources, picked per use case:

| Source                                         | Fidelity                           | Used by                                |
| ---------------------------------------------- | ---------------------------------- | -------------------------------------- |
| Session JSONL (`~/.claude/projects/*/*.jsonl`) | **100 %** — real API‑charged counts | `cost`, `context`, dashboard           |
| Anthropic `count_tokens` API                   | **100 %** — official endpoint      | `estimate` (needs `ANTHROPIC_API_KEY`) |
| `chars / 4`                                    | rough                              | `tokens`, fallback for `estimate`      |

Pricing is hard‑coded in `src/shared/pricing.ts` for the Claude 4.6 / 4.5 family. Update there when Anthropic changes prices.

## Context window vs cumulative cost

These are **different metrics**. `ctk` reports both:

- **Context window** = what Claude sees right now. Last turn's `input + cache_read + output`. Not a running sum — summing double‑counts cache reads.
- **Cumulative cost** = every turn's tokens weighted by per‑model prices. This is what `/cost` shows.

Use the window metric to decide when to `/compact` (70 / 85 / 95 % of 200k). Use cumulative to measure spend.

---

## Data & privacy

- **No telemetry, no accounts, no API keys required.** The only outbound call is the optional `count_tokens` pre‑flight in `ctk estimate`, which needs `ANTHROPIC_API_KEY` and is off by default.
- SQLite lives under `~/.claude/state/claude-master-toolkit/ctk.sqlite`. Override with `CTK_DB_PATH=/custom/path.sqlite`.
- `ctk install claude` writes symlinks and merges JSON into `~/.claude/` — backed up to `~/.claude/backups/cmt-<timestamp>/`. Run `ctk uninstall claude` to revert.

## Requirements

- Node.js **≥ 20**, < 25
- Claude Code installed (`~/.claude/` must exist for the integration layer)
- macOS / Linux (install scripts rely on symlinks)

## Uninstall

```bash
# Remove the integration layer (hooks, skills, persona). Restores the latest backup.
ctk uninstall claude

# Then remove the package itself
npm uninstall -g claude-master-toolkit
```

## Contributing / dev

```bash
git clone https://github.com/loviver/claude-master-toolkit
cd claude-master-toolkit
pnpm install
pnpm run build
./install.sh                 # local dev bootstrap: links bin/ctk into ~/.local/bin
ctk install claude           # optional: install the integration layer from this working copy
```

`install.sh` / `uninstall.sh` are **developer scripts**, not user‑facing. End users install from npm.

## License

MIT — see [LICENSE](./LICENSE).
