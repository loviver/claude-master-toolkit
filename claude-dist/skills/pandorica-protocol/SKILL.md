---
name: pandorica-protocol
description: Pandorica persistent memory protocol — save triggers proactivos, reglas de search, session close protocol, post-compaction recovery. Vault dark-themed (Doctor Who) nativo en ctk. Triggers: "guardá en memoria", "recordá esto", "acordate", "qué hicimos", "memory", "remember", "recall", "save to memory", "mem_save", "mem_recall". Siempre activo.
---

# Pandorica — Full Memory Protocol

> "The Pandorica. A box, a cage, a prison. Built to hold the most feared thing in the universe."
> — here it holds what must NEVER be forgotten across sessions.

Pandorica is a persistent memory system that survives across sessions and compactions.
It is implemented natively in `ctk` (SQLite + MCP tools + CLI).
This protocol is MANDATORY and ALWAYS ACTIVE.

## Tools disponibles (Pandorica v2 — `mem_*`)

MCP (6 verbos core — los únicos que ve el agente):

- `mem_save({ title, type?, what?, why?, where?, learned?, topic_key?, scope?, session_id?, project_path? })`
- `mem_recall({ query, limit?, type?, scope?, project_path? })` — FTS5 BM25 + semántico
- `mem_context({ project_path?, session_id?, limit? })` — recuperar estado reciente
- `mem_get({ id })` — completo, sin truncar; incrementa `access_count`
- `mem_trace({ project_path?, session_id?, limit? })` — timeline por fecha de creación
- `mem_session({ action: 'start'|'end'|'summary', content?, summary?, title?, session_id? })` — `session_id` por defecto = sesión actual

CLI: `ctk mem save|recall|context|trace|get|delete|summary|stats|export|import|reindex`.

## Proactive Save Triggers

Call `mem_save` IMMEDIATELY and WITHOUT BEING ASKED after any of:

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

Self-check after every task: "Did I make a decision, fix a bug, learn something non-obvious, or establish a convention? If yes → `mem_save` NOW."

## mem_save Format

- **title**: Verb + what — short, searchable ("Fixed N+1 query in UserList")
- **type**: `bugfix` | `decision` | `architecture` | `pattern` | `preference` | `reference` | `note` | `session_summary`
- **scope**: `project` (default) | `personal`
- **topic_key**: stable slug for evolving topics (`architecture/auth-model`). Upsert automático si coincide.
- Structured fields (NO concatenar en `what`):
  - **what**: one sentence — what happened
  - **why**: motivation / root cause
  - **where**: files / paths
  - **learned**: gotchas, surprises (omit si none)
- Cost-enrichment (`model`, `phase`, `tokens_*`, `cache_hit_pct`, `cost_usd`): lo llena el hook automáticamente; vía CLI `ctk mem save`.

## Topic Update Rules

- Different topics MUST NOT overwrite each other
- Same topic evolving → reuse `topic_key` (upsert automático)
- Know exact ID to fix → `mem_save` con mismo `topic_key`, o `ctk mem delete <id>` y re-save

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
