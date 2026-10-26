# Changelog

## 0.5.1

### Fixed
- The published package was missing `claude-dist/persona.md`, so `ctk install claude` left `~/.claude/persona.md` as a dangling link and sub-agents got no persona.
- `ctk install claude` / `ctk install codex` no longer create links to files missing from the package: they warn and skip, and remove a stale link to the missing file.
- New test installs both agents from exactly the files `npm pack` publishes and fails on any dangling link, so a packaging gap is caught before release.

## 0.5.0

### Added
- Dashboard **Code Graph** view (`/code-graph`): live 3D map of the AST index at module, file or symbol level, with scope drill-down, impact view (`focus` + depth), search, branch-risk overlay and "just reindexed" highlighting. Server routes `/api/code-graph`, `/api/code-graph/projects`, `/api/code-graph/revision`, `/api/code-graph/risk`.
- Code Graph readability: names stay on screen and declutter as you zoom, nodes gather into one island per zone with the zone name at its centre, search frames the node together with its callers and deps, and an **Overview** button reframes the whole graph.

### Changed
- Git stats run `git` through `execFileSync` (no shell).

### Fixed
- Two ctk builds sharing `~/.ctk` no longer erase each other's index: only an index **older** than the running build is rebuilt. A stale long-lived process (e.g. an MCP server started before an upgrade) leaves a newer index untouched and warns on stderr, and `ctk index build` refuses to write into an index built by a newer ctk.

### Removed (breaking)
- Workflow UI in the dashboard and the `/api/plans` routes.

## 0.4.0

### Added
- `ctk_map` MCP tool and `ctk index map` CLI: repo map ranked by weighted PageRank over the call (1.0) and reference (0.5) graph, optionally centered on `focus` files/symbols, cut to a token budget (default 1024).
- SessionStart refreshes the index (incremental, detached) in ctk‑active projects, in both the bash and TypeScript hook runtimes. Toggle: `CTK_HOOK_REINDEX=0`.
- `ctk_find`, `ctk_callers`, `ctk_deps`, `ctk_understand` and `ctk_map` return an explicit error with the fix when the project is not indexed, instead of empty results.
- `signatureTruncated` on `ctk_find` matches whose signature hit the 200‑char cap.
- MCP memory tools `mem_save`, `mem_recall`, `mem_context`, `mem_get`, `mem_trace`, `mem_session` (`action: start|end|summary`, session id defaults to the current session).
- `scripts/bench/oracle.ts`: verifies bench ground truth with the TypeScript type‑checker; new homonym, alias‑import, JSX and exploration tasks.

### Changed (breaking)
- `ctk_find` returns `depsCount` / `callersCount` instead of the `deps` / `callers` lists.
- `ctk_callers` includes `definitions` only when several definitions share the name (it repeated the flat lists otherwise).
- Index schema v5: the first open clears every project's symbol index (rebuilt automatically at session start in ctk‑active projects).
- Removed the `pandorica_*` MCP aliases and the deprecated `ctk pandorica` CLI. Use the `mem_*` tools and `ctk mem`.

### Fixed
- `export const x: Type = value` (non‑function) is indexed with signature `x: Type` instead of `null`.
- Hooks and docs referenced `mem_*` MCP tools that were never registered; agents only saw `pandorica_*`.
- Memory tool output is compact JSON (was pretty‑printed).

### Removed
- Pre‑v4 index compatibility paths (missing `dep_sites` / `referrers` columns).
- Legacy client type aliases `SessionGraph` / `SessionGraphNode` (use the `*DTO` names).

## 0.3.0

- Codex support: `ctk install codex` / `ctk uninstall codex`, hooks for Codex, MCP server registration and the sandbox grant for `~/.ctk`.
- Read‑only MCP tools run unattended in `codex exec` (`readOnlyHint`).
- `ctk_callers` returns `callSites`; `ctk_deps` accepts `symbol` and caps file‑level exports.
- Indexer tracks non‑call references and file imports; `file` disambiguates same‑named symbols.
- `ctk index build` reports which files errored and why.
- Index schema v4.
