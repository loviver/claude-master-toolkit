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

## Tools disponibles

- `pandorica_save(title, type, content, scope?, topic_key?, project_path?, session_id?)`
- `pandorica_search(query, limit?, type?, scope?, project_path?)`
- `pandorica_context(project_path?, session_id?, limit?)` — recover recent state
- `pandorica_get(id)` — full untruncated content
- `pandorica_session_summary(content, session_id?, project_path?, title?)`
- `pandorica_recent(project_path?, limit?)`

CLI equivalente: `ctk pandorica save|search|context|recent|get|delete|summary`.

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

## pandorica_save Format

- **title**: Verb + what — short, searchable (e.g. "Fixed N+1 query in UserList")
- **type**: `bugfix` | `decision` | `architecture` | `discovery` | `pattern` | `config` | `preference` | `session_summary`
- **scope**: `project` (default) | `personal`
- **topic_key** (recommended for evolving topics): stable key like `architecture/auth-model`
- **content**:
  - **What**: one sentence
  - **Why**: motivation
  - **Where**: files or paths
  - **Learned**: gotchas, surprises (omit if none)

## Topic Update Rules

- Different topics MUST NOT overwrite each other
- Same topic evolving → reuse `topic_key` (upsert automático)
- Know exact ID to fix → `pandorica_save` con mismo `topic_key`, o `ctk pandorica delete <id>` y re-save

## Search Triggers

On "remember", "recall", "qué hicimos", "acordate", or any reference to past work:
1. `pandorica_context` — recent session history (fast, cheap)
2. If not found, `pandorica_search` with relevant keywords
3. If found, `pandorica_get(id)` for full untruncated content

Search proactively when:
- Starting work that might have been done before
- User mentions a topic you have no context on
- User's FIRST message references the project/feature — search keywords before responding

## Session Close Protocol

Before ending a session or saying "done" / "listo", call `pandorica_session_summary` with:

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
1. IMMEDIATELY call `pandorica_session_summary` with the compacted summary content — persists what was done before compaction
2. Call `pandorica_context` to recover additional context
3. Only THEN continue working
