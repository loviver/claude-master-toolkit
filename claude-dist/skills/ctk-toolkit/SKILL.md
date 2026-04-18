---
name: ctk-toolkit
description: Reference card para tools ctk_* MCP — token-efficient symbol lookups, findings pool, brief protocol. Cargar cuando el sub-agente necesite recordar tools ctk disponibles o decidir entre ctk_understand vs Read. Triggers: "ctk tools", "mini-DSL", "symbol lookup", "findings pool", "buscar símbolo", "entender función".
---

# ctk toolkit — MCP reference

Nine MCP tools exposed by `ctk` server. PREFER over Read/Grep for code exploration — 60-75% fewer tokens.

## Decision: ctk vs Read

| Goal | Tool |
|------|------|
| Know symbol signature + body + deps + callers | `ctk_understand(symbol)` — 1 call |
| Find symbol by name | `ctk_find(name, kind?, exported?)` |
| File exports + deps | `ctk_deps(file)` |
| Who calls X | `ctk_callers(symbol)` |
| Non-TS file slice | `ctk_slice(file, symbol)` |
| Full file required | `Read` (LAST RESORT) |

## Tools

### ctk_understand(symbol)
Returns `{signature, body, range, file, deps, callers, tokens, exported}` in one call. USE FIRST.

### ctk_find(name, kind?, exported?)
Search AST index. `kind` ∈ class|function|method|type|interface|const|enum.

### ctk_deps(file) / ctk_callers(symbol)
Pre-computed from index. No file read.

### ctk_slice(file, symbol)
Regex + brace counting. Fallback when `ctk_understand` fails (non-indexed files).

### ctk_record(type, finding, symbol?, file?, confidence?, role?)
Save discovery to shared pool. `type` ∈ bug|assumption|decision|deadend|pattern.
USE when you: find bug, confirm assumption, hit dead-end, establish pattern.

### ctk_recall(type?, symbol?, session?, sinceMs?)
Query pool BEFORE exploring. Avoid duplicate work.

### ctk_brief_read(id) / ctk_brief_validate(id)
Contract for delegated task. `ctk_brief_read` FIRST before any exploration.

## Protocol

1. `ctk_brief_read(<task-id>)` — understand contract
2. `ctk_recall(symbol=<X>)` — check prior findings
3. `ctk_understand(<X>)` — get intel without Read
4. Work on task
5. `ctk_record(type, finding, symbol)` — persist discovery

## Rules

- Read is LAST RESORT, not default.
- Never explore outside Brief's Known Context without `ctk_record` first.
- If `ctk_understand` returns null → `ctk_find` → `ctk_slice` → Read.
