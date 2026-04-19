# Pandorica v2 — MCP `mem_*` Tools + Cost-Aware Memory

**Status:** Draft / Ready to start
**Owner:** handoff — next agent can pick up from Phase A
**Last updated:** 2026-04-18

## Executive summary

Absorb the 15-tool memory protocol popularized by [engram](https://github.com/Gentleman-Programming/engram) into `ctk`'s existing **Pandorica** memory layer. Goal: keep Pandorica's unique advantage (cost/token correlation via the `token_events` table) while gaining engram's structured memory schema, FTS5 full-text search, session lifecycle, and richer tool surface.

Outcome: a cost-aware, agent-agnostic MCP memory server that other agents (Cursor, Codex, VS Code) can consume via an engram-compatible alias layer, without losing `ctk`'s analytics joins.

## Why this exists (context for the next agent)

### Current state (Pandorica v1)

- ~6 MCP tools: `pandorica_save`, `pandorica_search`, `pandorica_context`, `pandorica_session_summary`, `pandorica_get`, `pandorica_recent`.
- Storage: SQLite via Drizzle ORM (`src/server/db/schema.ts`, table `memories`).
- Free-text saves — no `title/type/what/why/where/learned` structure.
- No FTS5 — search is `LIKE`-based.
- No explicit session lifecycle. No timeline. No passive capture. No merge. No stats/ROI.
- Claude-Code-only. No agent-agnostic surface.
- **Unique strength vs engram:** `memories` can join `token_events` + `sessions` → cost/memory correlation queries that engram cannot express.

### Target state (Pandorica v2)

- 15 MCP tools under the `mem_*` prefix (shorter than `pandorica_*` → fewer tokens per call; semantically distinct from engram's set).
- Structured schema (engram superset) + cost enrichment columns (`model`, `phase`, `tokens_input/output`, `cache_hit_pct`, `cost_usd`, `cost_saved_usd`, `access_count`).
- FTS5 virtual table over `title/what/why/where/learned`.
- Explicit session lifecycle (`mem_session` handles start/end/summary).
- Backward-compatible wrapper: existing `pandorica_*` calls keep working, forwarded to `mem_*` handlers.
- Optional Phase C: expose an engram-compatible `mem_*` alias layer so non-Claude agents can consume Pandorica as if it were engram.

### Key design decision

**Option 2 — Phased absorb, not federate.** We chose to absorb the engram protocol into Pandorica rather than federate (calling engram as a dependency) because federating would break the `memories ↔ token_events` join, which is `ctk`'s core competitive advantage. Full tradeoff analysis lives in the session transcript; the short version:

- Federating = lose cost correlation.
- Pure absorb with no agent rewiring = dead tools.
- **Phased absorb** = Phase A lands schema + tools (no behavior change required), Phase B rewires skills/hooks to populate the new fields, Phase C exposes engram-compatible aliases.

## Naming strategy

Engram uses generic `mem_*`. Pandorica v2 uses `mem_*` too — but with action-oriented verbs that reflect the cost-aware twist:

| Pandorica v2 | Closest engram equivalent | Why this name |
|---|---|---|
| `mem_save` | `mem_save` | Engram-compatible signature |
| `mem_update` | `mem_update` | — |
| `mem_delete` | `mem_delete` | — |
| `mem_mark` | `mem_suggest_topic_key` | User-driven, not NLP-guessed |
| `mem_recall` | `mem_search` | Implies return of access_count + cost_saved |
| `mem_context` | `mem_context` | — |
| `mem_trace` | `mem_timeline` | Correlates with `token_events` rows |
| `mem_get` | `mem_get_observation` | Shorter |
| `mem_session` | `session_start/end/summary` | Single tool, subcommand argument |
| `mem_passive` | `mem_capture_passive` | Shorter |
| `mem_merge` | `mem_merge_projects` | — |
| `mem_suggest` | `mem_suggest_topic_key` | NLP hints (distinct from `mem_mark`) |
| `mem_stats` | `mem_stats` | Adds cost/ROI metrics |
| `mem_export` | (engram git-sync) | Git-sync prep — dumps compressed chunks |
| `mem_import` | (engram git-sync) | Loads from backup |

## Schema (Phase A deliverable)

Migration file target: `src/server/db/migrations/NNNN_pandorica_v2.sql` (Drizzle-generated from updated `schema.ts`).

```sql
-- Extended memories table
CREATE TABLE memories_v2 (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,

  -- Engram-compatible core
  title TEXT NOT NULL,
  type TEXT CHECK(type IN ('decision', 'bugfix', 'architecture', 'pattern', 'preference', 'reference', 'note')),
  what TEXT,
  why TEXT,
  where_ TEXT,         -- `where` is reserved in SQLite
  learned TEXT,
  topic_key TEXT,

  -- CTK cost-correlation enrichment
  model TEXT,
  phase TEXT,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cache_hit_pct REAL,
  cost_usd REAL,

  -- Reuse / ROI tracking
  access_count INTEGER DEFAULT 0,
  cost_saved_usd REAL DEFAULT 0,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,
  accessed_at TIMESTAMP,

  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_memories_session ON memories_v2(session_id);
CREATE INDEX idx_memories_topic ON memories_v2(topic_key);
CREATE INDEX idx_memories_type ON memories_v2(type);
CREATE INDEX idx_memories_created ON memories_v2(created_at);

-- Full-text search over narrative fields
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, what, why, where_, learned,
  content='memories_v2',
  content_rowid='rowid'
);

-- Keep FTS index in sync
CREATE TRIGGER memories_ai AFTER INSERT ON memories_v2 BEGIN
  INSERT INTO memories_fts(rowid, title, what, why, where_, learned)
  VALUES (new.rowid, new.title, new.what, new.why, new.where_, new.learned);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories_v2 BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, what, why, where_, learned)
  VALUES ('delete', old.rowid, old.title, old.what, old.why, old.where_, old.learned);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories_v2 BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, what, why, where_, learned)
  VALUES ('delete', old.rowid, old.title, old.what, old.why, old.where_, old.learned);
  INSERT INTO memories_fts(rowid, title, what, why, where_, learned)
  VALUES (new.rowid, new.title, new.what, new.why, new.where_, new.learned);
END;

-- Search events (for recall analytics)
CREATE TABLE memory_searches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  memory_id TEXT,           -- NULL if no hit
  query TEXT NOT NULL,
  rank REAL,                -- FTS5 BM25 score
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (memory_id) REFERENCES memories_v2(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

### Backfill policy (question #4 from planning — answer required)

Migration strategy for existing `memories` rows has two options:

- **Option X: wipe + re-index** — simplest, loses history. Only viable if the user confirms their current memories are disposable.
- **Option Y: backfill** — copy existing rows into `memories_v2` with `title = first_line(body)`, `what = body`, and all new cost fields NULL. Non-destructive.

**Default to Option Y unless the user explicitly says otherwise.** Existing Pandorica memories are user-generated and non-reproducible.

## Phase breakdown

### Phase A — Schema + tools land (no behavior change required)

Goal: 15 `mem_*` tools exist and work. Cost fields default NULL. Agents can keep calling `pandorica_*` unchanged.

Tasks, in order:

1. **Audit** (read-only, ~30 min)
   - Read `src/server/db/schema.ts` → document current `memories` table shape.
   - Read `src/server/routes/memories.ts` (or wherever Pandorica MCP handlers live) → list current tool signatures.
   - Diff against this plan's schema. Note any column-name conflicts.
   - Save findings via `pandorica_save` (meta: use the existing tool before migrating it).

2. **Drizzle schema update**
   - Edit `src/server/db/schema.ts`: add `memoriesV2` table + `memorySearches` table.
   - Run `npm run db:generate`.
   - Review generated SQL. Manually add the FTS5 `CREATE VIRTUAL TABLE` + triggers (Drizzle does not generate FTS5 natively; emit raw SQL in a sibling migration file).
   - Run `npm run db:migrate`.

3. **Backfill migration**
   - Write a one-shot script `src/server/db/backfill-v2.ts` that copies `memories` → `memories_v2` with the field mapping above.
   - Run it once locally, verify row count parity, then archive the script (do not ship it as a repeating migration).

4. **MCP tool handlers** (new file per tool, or one grouped file `src/server/mcp/mem-tools.ts`)
   - Implement all 15 handlers per the table above.
   - `mem_recall` must use FTS5 (`MATCH` operator + BM25 rank), not `LIKE`.
   - Every handler that reads a memory must increment `access_count` and update `accessed_at`.
   - `mem_recall` / `mem_context` must log a row in `memory_searches` for every query, hit or miss.
   - Cost enrichment fields (`model`, `phase`, etc.) accept nullable input — Phase A does not require callers to fill them.

5. **Backward-compatibility shim**
   - Keep all `pandorica_*` tools registered; route their bodies through the new `mem_*` handlers.
   - `pandorica_save(text)` → `mem_save({ title: first_line(text), what: text, type: 'note' })`.
   - `pandorica_search(query)` → `mem_recall({ query })`.
   - `pandorica_context(topic)` → `mem_context({ topic_key: topic })`.
   - `pandorica_recent()` → `mem_trace({ limit: 20 })`.
   - Do **not** remove the old tools in Phase A. They are removed in Phase B only after skills/hooks are updated.

6. **Tests** (`src/server/__tests__/mem-tools.test.ts` or co-located)
   - Happy-path test per tool.
   - FTS5 rank ordering test (higher rank first).
   - Access-count increment test.
   - Backward-compat wrapper test (call `pandorica_save`, assert new row in `memories_v2`).

7. **Docs**
   - Update `CLAUDE.md` § Persistent Memory block — list the new tools.
   - Update `claude-dist/skills/pandorica-protocol/SKILL.md` — document the new verbs and their cost-correlation semantics.
   - Do **not** rewrite every skill that mentions `pandorica_save` yet — that is Phase B.

**Phase A exit criteria:** all 15 `mem_*` tools callable via MCP, FTS5 search works, existing agents using `pandorica_*` see no change, `npm run test` green.

### Phase B — Rewire skills + hooks to exploit the new fields

Goal: agents actually populate `title/type/what/why/where/learned` and the cost-enrichment fields, unlocking the analytics queries listed below.

Tasks:

1. Rewrite `claude-dist/skills/pandorica-protocol/SKILL.md` so the save protocol emits structured fields.
2. Update the `Stop` hook (currently reminds when ≥3 Edits + 0 saves) to prefer `mem_save` calls and sample cost from the latest `token_events` row to populate enrichment fields automatically.
3. Port these engram skills (from `../itboxful/engram/skills/`) into `claude-dist/skills/`, overwriting existing versions when the engram version is stronger: `memory-protocol`, `commit-hygiene`, `pr-review-deep`, `sdd-flow`, `architecture-guardrails`, `testing-coverage`, `backlog-triage`. Skip TUI/HTMX-specific skills — stack mismatch.
4. Compress skill prose with the `caveman:compress` skill where verbose. Goal: keep essence, drop token weight.
5. Remove the `pandorica_*` legacy aliases.
6. Add dashboard views for the analytics queries in "Use cases" below.

**Phase B exit criteria:** new memories land with non-null `type`, `what`, `why`, `where_`, and `model`/`cost_usd`. The ROI query (below) returns non-empty results.

### Phase C — Engram-compatible alias layer (optional / stretch)

Goal: other MCP clients (Cursor, Codex, VS Code Copilot) can point at Pandorica's MCP server and use it as a drop-in engram replacement.

Tasks:

1. Register `mem_save_prompt`, `mem_get_observation`, `mem_session_start`, `mem_session_end`, `mem_session_summary`, `mem_capture_passive`, `mem_merge_projects`, `mem_suggest_topic_key`, `mem_timeline` as aliases over the Pandorica v2 handlers. Parameter shapes must match the engram MCP schema exactly.
2. Document setup in `docs/AGENT-SETUP.md` mirroring engram's table (Claude Code / OpenCode / Gemini CLI / Codex / VS Code / Cursor).
3. Add an integration test that drives the server with the engram MCP schema and asserts Pandorica rows are created correctly.

**Phase C exit criteria:** a non-Claude agent configured against `ctk serve` (or equivalent) can save and recall memories using engram-schema calls.

## Use cases the absorbed protocol unlocks

### 1. Cost dashboard — "which sessions paid for memory?"

```sql
SELECT
  s.id AS session_id,
  SUM(te.cost_usd) AS total_cost,
  COUNT(DISTINCT m.id) AS memories_created,
  COUNT(DISTINCT ms.id) AS memories_searched
FROM sessions s
JOIN token_events te ON te.session_id = s.id
LEFT JOIN memories_v2 m ON m.session_id = s.id
LEFT JOIN memory_searches ms ON ms.session_id = s.id
GROUP BY s.id
ORDER BY total_cost DESC;
```

### 2. Memory ROI — "which memories save the most tokens on reuse?"

```sql
SELECT
  m.topic_key,
  m.title,
  m.access_count,
  m.cost_saved_usd,
  (m.cost_saved_usd / NULLIF(m.access_count, 0)) AS avg_saving_per_hit
FROM memories_v2 m
WHERE m.access_count > 0
ORDER BY m.cost_saved_usd DESC
LIMIT 20;
```

### 3. Anomaly — "high-cost sessions that did not consult memory"

```sql
SELECT s.id, SUM(te.cost_usd) AS cost, COUNT(ms.id) AS searches
FROM sessions s
JOIN token_events te ON te.session_id = s.id
LEFT JOIN memory_searches ms ON ms.session_id = s.id
GROUP BY s.id
HAVING cost > (SELECT AVG(cost_usd) * 2 FROM token_events)
   AND searches < 3;
```

## Open questions (confirm with user before starting)

1. **Backfill strategy** — Option X (wipe) vs Option Y (backfill). Default: Y.
2. **Phase B timing** — is there a deadline, or land Phase A and re-evaluate?
3. **Phase C scope** — ship in this effort, or split into its own initiative once Phase B proves the value?
4. **Skill overwrites (Phase B)** — the user confirmed "overwrite if engram better, no v2 parallel." Honor that. Keep a single backup tag in git before overwrite so rollback is trivial.

## References

- Engram source: `/home/oliver-boxful/Documentos/Coding/itboxful/engram/`
- Engram README lists the 15 tools and their schema.
- Current Pandorica: `src/server/db/schema.ts`, `src/server/routes/` (exact MCP file locations to be confirmed in Phase A audit step 1).
- CTK conventions: `CLAUDE.md` (root) — ESM, Drizzle, Vitest, conventional commits with no AI attribution.

## Handoff notes

- The user writes in Spanish. Respond in Spanish. Keep caveman mode respected where configured.
- Do not add AI attribution to commits (`Co-Authored-By`, `🤖`, etc.) — hard-enforced by a pre-commit hook.
- Strict TDD mode is enabled globally — write failing tests before implementation for every `mem_*` handler in Phase A.
- Use `ctk model <phase>` before any `Agent` delegation. Prefer `/delegate` over raw `Agent`.
- Before starting Phase A, confirm open questions 1–3 with the user.
