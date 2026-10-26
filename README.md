# claude-master-toolkit

**An operation layer for [Claude Code](https://claude.ai/code) and [Codex](https://github.com/openai/codex).**

`ctk` is a CLI and local dashboard that turns Claude Code's session JSONL files into something you can actually measure, search, and control — cost telemetry, context‑window warnings, persistent memory, model routing, and a web dashboard. The symbol index, persistent memory and hooks also run on Codex. All local, all offline, opt‑in per feature.

```bash
npm install -g claude-master-toolkit
ctk dashboard          # http://localhost:3200
```

> This is not a replacement for Claude Code or Codex. It's a layer on top of them. You still need `claude` and/or `codex` installed and logged in. Cost telemetry and the dashboard read Claude Code session files; the integration layer supports both agents.

---

## What's actually in the box

| Component              | What it does                                                                                                 | Where it lives                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **Dashboard**          | React SPA + Fastify server on `:3200`. Shows sessions, token events, costs, memories.                        | `ctk dashboard`                           |
| **Cost telemetry**     | Parses `~/.claude/projects/**/*.jsonl` into SQLite. Real API‑charged counts, not heuristics.                 | `ctk cost`, `ctk context`, dashboard      |
| **Context guardian**   | Hooks that warn when you cross 70 / 85 / 95 % of the window — before Claude Code does.                       | installed by `ctk install claude`         |
| **Pandorica**          | Persistent memory vault (SQLite). Save decisions/bugs/patterns, search across sessions and projects.         | `ctk mem …`, MCP `mem_*`                  |
| **Model router**       | `ctk model <phase>` returns an alias (opus/sonnet/haiku) per SDD phase. Sub‑agents inherit it via `/delegate`. | `ctk model`, `ctk model-pref`             |
| **Code indexer**       | Tree‑sitter + ts‑morph symbol index for TS, Go, Python, Rust. Type‑resolved, **file‑qualified** call/dep edges (collision‑proof); a PostToolUse hook keeps it fresh. Find / callers (with call‑site lines) / deps (file or single symbol) in JSON. | `ctk index …`, `ctk understand`           |
| **ODD risk routing**   | `ctk risk` scores a branch DIRECT / GUARDED / DELEGATE off the symbol index — blast radius, public API, spread, churn — to right‑size delegation. | `ctk risk`, MCP `ctk_risk`                |
| **MCP server**         | Exposes Pandorica + indexer as MCP tools so Claude Code and Codex can call them directly.                    | registered on `ctk install claude` / `codex` |
| **Bench harness**      | A/B runs (ctk vs baseline) from Claude Code JSONL with export/import of the bench DB. A Codex A/B harness lives in the repo (see Contributing). | `ctk bench …`                             |
| **Bash primitives**    | `slice`, `find`, `git-log`, `git-changed`, `test-summary` — compact output for agent loops.                  | `ctk <cmd>`                               |

ctk's own state lives in `~/.ctk/` (override with `CTK_HOME`); Claude Code session files under `~/.claude/projects/` are only read. Nothing phones home.

---

## Two ways to use it

### 1 · Standalone — just the dashboard and CLI

```bash
npm install -g claude-master-toolkit
ctk dashboard
```

This does **not** touch your Claude Code config. It reads session JSONL, writes its own SQLite under `~/.ctk/`, and exposes a dashboard + CLI. Uninstall with `npm uninstall -g claude-master-toolkit`.

### 2 · Integrated — hooks, skills, MCP, persona

```bash
ctk install claude
```

This **modifies your Claude Code environment** (with a timestamped backup at `~/.claude/backups/cmt-<ts>/`):

- Symlinks an opinionated `CLAUDE.md` persona into `~/.claude/CLAUDE.md`
- Symlinks skills (`sdd-new`, `sdd-ff`, `sdd-continue`, `pandorica-protocol`, `delegate`, `ctk-toolkit`) and the `sdd-orchestrator` agent into `~/.claude/`
- Installs hooks (`session-start`, `user-prompt-submit`, `pre-tool-use`, `post-tool-use`, `stop`, `pre-compact`, `subagent-start`, `subagent-stop`, `session-end`) into `~/.claude/hooks/` — `post-tool-use` keeps the symbol index fresh by reindexing in the background after each edit
- Merges hook + MCP registrations into `~/.claude/settings.json`
- Optionally installs the third‑party `caveman` plugin (skip with `--skip-caveman`)

Revert anytime with `ctk uninstall claude` (restores the latest backup).

**Read the persona before installing.** It's a "senior architect / passionate teacher" opinionated persona. If you don't want it, use standalone mode.

### 3 · Codex

```bash
ctk install codex        # or `ctk install all` to cover every agent found on the machine
```

This edits `~/.codex/` and only touches what ctk owns (revert with `ctk uninstall codex`):

- Adds an `ctk` MCP server block to `~/.codex/config.toml`
- Adds `~/.ctk` to `[sandbox_workspace_write].writable_roots` — without it, `ctk` commands fail inside the Codex sandbox with `SQLITE_CANTOPEN` (SQLite needs to create `-wal`/`-shm`). If you already define that table, ctk warns and leaves it alone
- Registers hooks in `~/.codex/hooks.json` for the events whose payload contract is verified (tool hooks match `Bash` only); your own entries are kept
- Symlinks the agent‑neutral skills into the Codex skills dir

Not installed on Codex: the Claude persona, and the `sdd-*` / `delegate` skills (they still reference Claude‑specific paths and the `Agent` tool).

**Non‑interactive use (`codex exec`).** Codex needs approval for MCP tools unless the server marks them read‑only. ctk marks its read‑only tools (`ctk_find`, `ctk_understand`, `ctk_deps`, `ctk_callers`, `ctk_slice`, `ctk_recall`, `ctk_brief_*`, `ctk_risk`, `ctk_map`, `mem_recall|context|get|trace`) with `readOnlyHint`, so they run unattended. Tools that write (`ctk_record`, `mem_save`, `mem_session`) still require approval — by design.

---

## What's new in 0.5.0

Breaking changes are marked **⚠**. Full history in [CHANGELOG.md](./CHANGELOG.md).

- **Code Graph** — `ctk dashboard` → *Code Graph*: live 3D map of the AST index (modules, files, symbols) with drill-down, impact view, search and branch-risk overlay. Names declutter as you zoom, zones form labelled islands, and search frames a node with its callers and deps.
- **Index survives mixed ctk versions** — a process running an older ctk (typically an MCP server started before an upgrade) no longer wipes a newer index, and `ctk index build` refuses to write into one.
- **⚠ Workflow UI removed** — the dashboard workflow editor and the `/api/plans` routes are gone.

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
| `ctk index build`            | Build a semantic symbol index. Reports `errored` files with `errors` (file + message) and `errorCauses`. |
| `ctk index find <symbol>`    | Locate a symbol (filter by kind / exported).                  |
| `ctk index deps <file>`      | Imports + exports of a file.                                  |
| `ctk index map`              | Repo map: top symbols by PageRank under a token budget. `--focus a,b` centers it on files/symbols, `--budget <tokens>` (default 1024). |
| `ctk index callers <symbol>` | Who calls / references this symbol. `--file` pins a definition, `--include calls\|refs\|all`. Each caller carries `callSites` (lines of the call). |
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
| `ctk mem save --title ... --type ...` | Save a memory (`decision`, `bugfix`, `architecture`, `pattern`, `preference`, `reference`, `note`, `session_summary`). |
| `ctk mem recall <q>`                  | Hybrid search (keyword + semantic).                       |
| `ctk mem reindex`                     | (Re)compute semantic embeddings for the whole vault.      |
| `ctk mem context`                     | Recent memories for current project/session.              |
| `ctk mem trace`                       | Timeline of memories by creation date.                    |
| `ctk mem get <id>`                    | Full untruncated memory.                                  |
| `ctk mem delete <id>`                 | Delete a memory.                                          |
| `ctk mem summary`                     | Persist a session summary.                                |
| `ctk mem stats` / `export` / `import` | ROI and counts / dump and restore the vault.              |

#### Hybrid recall (v0.2.0)

Search fuses two legs so a reworded or cross-language query still hits:

- **Keyword** — FTS5/BM25, now OR-joined (one missing term no longer zeroes the query).
- **Semantic** — dense embeddings scored by cosine, so `"ai credits"` finds a memory saved as `"créditos IA"`.

The two ranked lists are merged with Reciprocal Rank Fusion. The vault stays a single SQLite file (vectors live in a `memory_embeddings` sidecar; brute-force cosine, no native vector extension).

The embedder is pluggable and **off nothing is lost** — if it's unavailable, recall silently falls back to keyword-only. Configure via `settings` keys or env:

| Setting (`settings` table) / env         | Default                                            | Notes                                            |
| ----------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| `pandorica.embedder` / `CTK_EMBEDDER`     | `local`                                            | `local` · `ollama` · `api` · `none`              |
| `pandorica.embedModel` / `CTK_EMBED_MODEL`| `Xenova/paraphrase-multilingual-MiniLM-L12-v2`     | multilingual (ES+EN), 384-dim                    |
| `pandorica.embedEndpoint` / `CTK_EMBED_ENDPOINT` | ollama: `http://localhost:11434` · api: OpenAI | for `ollama` / `api`                             |
| `CTK_EMBED_API_KEY` / `OPENAI_API_KEY`    | —                                                  | for `api`                                        |

`local` uses transformers.js (installed as an **optional** dependency; the model downloads once, then fully offline). After upgrading, run `ctk mem reindex` once to embed existing memories; new memories saved through the MCP server embed automatically.

### MCP code tools

| Tool | Notes |
| ---- | ----- |
| `ctk_map` | Repo map: top symbols by PageRank over the call/reference graph, with signatures, grouped by file, cut to `budget` tokens (default 1024). `focus` (files or symbols) centers it on an area. Use it first to get oriented. |
| `ctk_find` | Locate a symbol: file, range, signature and `depsCount` / `callersCount` (no lists). Same‑named definitions are ranked (exported first); pass `file` to pin one. `signatureTruncated: true` → use `ctk_slice` for the full text. |
| `ctk_understand` | Signature + body + deps + callers in one call. `deps`/`callers` are capped — see `depsCount` / `callersCount`. Built‑ins/globals (e.g. `Intl`) are not listed as deps; only in‑project symbols are. |
| `ctk_deps` | File‑level by default (exports capped at 50, full count in `exportsCount`). Pass `symbol` to scope exports, deps, refs and imports to that one symbol. |
| `ctk_callers` | `callers` = call edges, `referrers` = type/const usage. For types, interfaces and constants use `include: "refs"` or `"all"` (default) — `"calls"` returns nothing for them. Each entry is the calling *symbol*; `callSites` lists the lines inside it where the call happens. `definitions` groups them per definition only when several definitions share the name. |
| `ctk_slice` | Raw extraction of one symbol block, for files the index doesn't cover. |

`callSites` is produced by the ts‑morph indexer (TypeScript/JavaScript). Symbols indexed by tree‑sitter (Go, Python, Rust) have callers but no call‑site lines.

#### Upgrading the index (0.4.0)

The index schema moved to **v5**. The first time 0.4.0 opens the database it clears the symbol index of **every** project. In projects initialized with `ctk init`, the SessionStart hook rebuilds it in the background, so nothing is needed. Elsewhere run `ctk index build --path <project>` once; until then the code tools answer with an error that says exactly that. Pandorica memories are not affected. Since 0.5.0 an older ctk process never clears a newer index: restart it (e.g. reconnect the ctk MCP server) to pick up the current build.

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
- SQLite lives at `~/.ctk/ctk.sqlite`. Move the whole home with `CTK_HOME=/custom/dir`, or just the database with `CTK_DB_PATH=/custom/path.sqlite`. Data from the old `~/.claude/state/claude-master-toolkit/` location is migrated automatically (skipped when `CTK_DB_PATH` is set).
- `ctk install claude` writes symlinks and merges JSON into `~/.claude/` — backed up to `~/.claude/backups/cmt-<timestamp>/`. Run `ctk uninstall claude` to revert.
- `ctk install codex` edits `~/.codex/config.toml` and `hooks.json`, and records exactly what it wrote under `~/.ctk/installs/`. Run `ctk uninstall codex` to revert.

## Requirements

- Node.js **≥ 20**, < 25
- Claude Code installed (`~/.claude/` must exist for `ctk install claude`) and/or Codex (`~/.codex/` for `ctk install codex`)
- macOS / Linux (install scripts rely on symlinks)

## Uninstall

```bash
# Remove the integration layer (hooks, skills, persona). Restores the latest backup.
ctk uninstall claude
ctk uninstall codex          # only what ctk installed in ~/.codex

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

### Benchmarking ctk on Codex

`scripts/bench/codex-bench.ts` (repo only, not in the npm package) compares agents with and without the ctk MCP through `codex exec --json`. Each task × variant × repetition runs in a fresh session with `--ignore-user-config` (no hooks, no user MCP); the only difference is the ctk server. Metrics are read from Codex's event stream and rollout log — token usage, tool calls, MCP server time (`item.duration`) — and answers are graded against ground truth in `scripts/bench/tasks.json`.

```bash
pnpm run build:cli                              # the MCP server and indexer run from dist/
npx tsx scripts/bench/oracle.ts                 # verify tasks.json ground truth against the code
npx tsx scripts/bench/codex-bench.ts --reps 3   # results in .ctk/bench/codex-<date>.{md,json}
```

`oracle.ts` recomputes each task's answer with the TypeScript type-checker (definitions, callers through import aliases, JSX renders, importers) and exits non-zero when `tasks.json` drifted from the code, so a stale task never grades a run. The task set covers plain lookups plus the cases text search gets wrong: same-named functions in different files, aliased imports, JSX usage, and open-ended exploration.

Measure MCP latency from `item.duration`, not from the wall time around the call: the latter includes client overhead and is not comparable with a shell `time`.

## License

MIT — see [LICENSE](./LICENSE).
