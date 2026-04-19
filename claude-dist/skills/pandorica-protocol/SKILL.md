---
name: pandorica-protocol
description: Pandorica persistent memory protocol — save triggers proactivos, reglas de search, session close protocol, post-compaction recovery. Vault dark-themed (Doctor Who) nativo en ctk. Triggers: "guardá en memoria", "recordá esto", "acordate", "qué hicimos", "memory", "remember", "recall", "save to memory", "pandorica_save", "pandorica_search". Siempre activo.
---

# Pandorica — Full Memory Protocol

> "The Pandorica. A box, a cage, a prison. Built to hold the most feared thing in the universe."
> — here it holds what must NEVER be forgotten across sessions.

Pandorica is a persistent memory system that survives across sessions and compactions.
It is implemented natively in `ctk` (SQLite + MCP tools + CLI).
This protocol is MANDATORY and ALWAYS ACTIVE.

## Tools disponibles (Pandorica v2 — `mem_*`)

Structured schema + FTS5 + cost-enrichment. 15 verbs:

- `mem_save({ title, type, what, why?, where_?, learned?, topic_key?, scope?, session_id?, project_path?, model?, phase?, tokens_input?, tokens_output?, cache_hit_pct?, cost_usd? })`
- `mem_update(id, patch)` / `mem_delete(id)` / `mem_get(id)` — full untruncated + increments `access_count`
- `mem_mark(id, topic_key)` — user-driven topic tagging
- `mem_recall({ query, limit?, type?, scope?, project_path? })` — FTS5 BM25 rank
- `mem_context({ topic_key?, project_path?, session_id?, limit? })` — recover recent/topic state
- `mem_trace({ session_id?, limit? })` — timeline con cost correlation
- `mem_session({ action: 'start'|'end'|'summary', ... })`
- `mem_passive(observation)` — capture sin structure
- `mem_merge(source_id, target_id)`
- `mem_suggest(text)` — NLP topic_key hints
- `mem_stats({ project_path? })` — ROI + cost_saved
- `mem_export({ path })` / `mem_import({ path })`

Legacy alias (backward-compat, ruteado a `mem_*`): `pandorica_save` / `_search` / `_context` / `_get` / `_session_summary` / `_recent`.

CLI: `ctk pandorica save|search|context|recent|get|delete|summary` (sigue funcionando).

## Proactive Save Triggers

Call `pandorica_save` IMMEDIATELY and WITHOUT BEING ASKED after any of:

- Architecture or design decision made
- Team convention documented or established
- Workflow change agreed upon
- Tool or library choice made with tradeoffs
- Bug fix completed (include root cause)
- Feature implemented with non-obvious approach
- Notion / Jira / GitHub artifact created or updated with significant content
- Configuration change or environment setup done
- Non-obvious discovery about the codebase
- Gotcha, edge case, or unexpected behavior found
- Pattern established (naming, structure, convention)
- User preference or constraint learned

Self-check after every task: "Did I make a decision, fix a bug, learn something non-obvious, or establish a convention? If yes → `pandorica_save` NOW."

## mem_save Format

- **title**: Verb + what — short, searchable ("Fixed N+1 query in UserList")
- **type**: `bugfix` | `decision` | `architecture` | `pattern` | `preference` | `reference` | `note` | `session_summary`
- **scope**: `project` (default) | `personal`
- **topic_key**: stable slug for evolving topics (`architecture/auth-model`). Upsert automático si coincide.
- Structured fields (NO concatenar en `what`):
  - **what**: one sentence — what happened
  - **why**: motivation / root cause
  - **where_**: files / paths
  - **learned**: gotchas, surprises (omit si none)
- Cost-enrichment (opcional, Phase B los llena el hook automáticamente): `model`, `phase`, `tokens_input`, `tokens_output`, `cache_hit_pct`, `cost_usd`.

Legacy `pandorica_save(text)` → ruteado a `mem_save({ title: first_line(text), what: text, type: 'note' })`. Nuevo código: usar `mem_save` directo.

## Topic Update Rules

- Different topics MUST NOT overwrite each other
- Same topic evolving → reuse `topic_key` (upsert automático)
- Know exact ID to fix → `pandorica_save` con mismo `topic_key`, o `ctk pandorica delete <id>` y re-save

## Search Triggers

On "remember", "recall", "qué hicimos", "acordate", or any reference to past work:
1. `mem_context` — recent session / topic state (fast, cheap)
2. If not found, `mem_recall(query)` — FTS5 BM25 ranking
3. If hit, `mem_get(id)` — full untruncated + bumps `access_count`

Search proactively when:
- Starting work that might have been done before
- User mentions a topic you have no context on
- User's FIRST message references the project/feature — search keywords before responding

## Session Close Protocol

Before ending a session or saying "done" / "listo", call `mem_session({ action: 'summary', content })` with:

```
## Goal
[What we worked on this session]

## Instructions
[User preferences or constraints discovered — skip if none]

## Discoveries
- [Technical findings, gotchas, non-obvious learnings]

## Accomplished
- [Completed items with key details]

## Next Steps
- [What remains for the next session]

## Relevant Files
- path/to/file — [what it does or what changed]
```

NOT optional. Without this the next session starts blind.

## After Compaction

If you see a compaction message or "FIRST ACTION REQUIRED":
1. IMMEDIATELY `mem_session({ action: 'summary', content })` with compacted summary — persists pre-compaction state
2. `mem_context` — recover additional context
3. Only THEN continue working
