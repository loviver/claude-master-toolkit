---
name: delegate
description: Wrapper para el tool Agent. Enforza ctk model selection, brief protocol, context budget, y MCP toolkit preference. Usar SIEMPRE en vez de Agent crudo para delegar — cuando el usuario pida delegá, explorá, investigá, revisá, analizá, implementá, or says delegate/explore/investigate/review/analyze/implement. Also triggers on: "lanzá un sub-agent", "corré en paralelo", "sub-agente", "sub-agent".
---

# /delegate

Launch a sub-agent with enforced model selection (`ctk model`), a strict task brief, and MCP toolkit preference.

## Usage

```
/delegate <phase> <description>
```

Where `<phase>` is one of: `sdd-explore`, `sdd-propose`, `sdd-spec`, `sdd-design`, `sdd-tasks`, `sdd-apply`, `sdd-verify`, `sdd-archive`, `explore`, `implement`, `review`, `general`.

If no phase is given, default to `general`.

## Action — follow these steps IN ORDER

### Step 0: Brief obligatorio (contrato)

Sub-agents arrancan con un contrato explícito, no con exploración libre.

1. Generate task-id as kebab-case `<verb>-<noun>` from description (e.g. `explore-auth-middleware`, `fix-token-overflow`).
2. Run:
   ```bash
   ctk brief new <task-id> --task="<one-line description>"
   ```
3. Open the generated file at `~/.claude/ctk/briefs/<task-id>.md` and FILL:
   - **Known Context** — symbols/files already known from conversation (use `ctk_find` to verify ranges)
   - **Allowed Actions** — edits limited to specific files/lines
   - **Success Criteria** — verifiable condition (test passes, output matches, etc.)
4. Validate:
   ```bash
   ctk brief validate <task-id>
   ```
   STOP if exit≠0 — missing fields. Fix brief first.

### Step 1: Resolve model

```bash
ctk model {PHASE}
```

Capture output — pass as `model` param to Agent. Never hardcode.

### Step 2: Check context budget

```bash
ctk context
```

- 70-85% → warn, suggest `/compact`
- >85% → STOP, do not launch

### Step 3: Launch Agent

Call the Agent tool with:

- `model`: value from Step 1
- `description`: from user args
- `prompt`: MUST include this toolkit preamble verbatim:

```
BRIEF: ~/.claude/ctk/briefs/<task-id>.md — READ FIRST.
Run: ctk_brief_read(id="<task-id>") before anything else.

MCP tools available (prefer over Read/Grep for code lookups):
 - ctk_understand(symbol) → signature + body + deps + callers in ONE call. 60-75% fewer tokens than Read.
 - ctk_find(name, kind?, exported?) → search index without reading files
 - ctk_deps(file) → exports + dependency symbols, no file read
 - ctk_callers(symbol) → reverse lookup
 - ctk_slice(file, symbol) → raw extraction (fallback for non-TS files)
 - ctk_recall(type?, symbol?) → check what other agents already found. RUN BEFORE exploring a symbol.
 - ctk_record(type, finding, symbol?) → save discoveries for future agents (bug|assumption|decision|deadend|pattern)

RULES:
1. Read is a LAST RESORT. Use ctk_understand first.
2. Do NOT explore outside the Brief's Known Context without recording a finding via ctk_record.
3. Before deep-diving a symbol, run ctk_recall to avoid duplicate work.
4. If you make important discoveries, save to pandorica via pandorica_save AND ctk_record.
```

Then the actual task description + relevant files.

### Step 4: Relay result

After agent returns, relay concisely. Do NOT dump raw output.

## Examples

```
/delegate explore Investigate how auth middleware handles session tokens
/delegate sdd-propose Design the new caching layer for API responses
/delegate review Review changes in src/services/ for correctness
/delegate general Refactor the test suite to use fixtures
```

## Why this exists

Three enforcement layers in one skill:

1. **Model selection** — `ctk model` cannot be skipped
2. **Brief protocol** — sub-agents start with ~500 tok contract vs ~5000 tok re-exploration
3. **MCP preference** — steers agents to `ctk_*` tools instead of Read, saving 60-75% tokens on symbol lookups
