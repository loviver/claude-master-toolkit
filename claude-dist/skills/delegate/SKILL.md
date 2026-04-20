---
name: delegate
description: Wrapper para el tool Agent. Enforza ctk model selection, brief protocol, context budget, y MCP toolkit preference. Triggers on delegation verbs (Spanish + English, con/sin tildes, todas las variantes LATAM): "delega(r)/delegá/delegate", "explora(r)/explorá/explore", "investiga(r)/investigá/investigate", "revisa(r)/revisá/review", "analiza(r)/analizá/analyze", "implementa(r)/implementá/implement", "chequea(r)/chequeá/check", "valida(r)/validá/validate", "refactoriza(r)/refactorizá/refactor", "testea(r)/testeá/test". Also: "lanza(r) un sub-agent/lanzá un sub-agent", "corre(r) en paralelo/corré en paralelo/run in parallel", "sub-agente/sub-agent", "en background/in background", "busca(r)/buscá/find", "verifica(r)/verificá/verify". Variantes regionales: vos/tú/usted + imperativo/infinitivo todos OK.
---

# /delegate

Launch a sub-agent with enforced model selection (`ctk model`), strict task brief, and MCP toolkit preference.

Triggers on:
- **Explicit** — `/delegate <phase> <task>`
- **Implicit** — natural language with delegation verbs (Spanish/English mix OK, con/sin tildes: "explorá" / "explora", "investigate" / "investiga", "revisá un PR", "validate the types", etc.)
- **Parallel** — "corré en paralelo" / "corre en paralelo" / "run in parallel" auto-launches multiple agents
- **Regional** — vos/tú/usted imperativo, infinitivo, todo funciona igual

No need to prefix with `/` — the skill recognizes delegation intent naturally. Works across all Latin American Spanish variants and English.

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

### Explicit `/delegate` syntax
```
/delegate explore Investigate how auth middleware handles session tokens
/delegate sdd-propose Design the new caching layer for API responses
/delegate review Review changes in src/services/ for correctness
/delegate general Refactor the test suite to use fixtures
```

### Natural language triggers (auto-recognizes delegation intent)

**Español con tilde (vos/tú/usted):**
```
Explorá el middleware de autenticación y cómo maneja tokens de sesión
Investiga por qué el cache miss rate está aumentando (infinitivo)
Revisá los cambios en src/services/ para asegurar que sean correctos
Analizá el rendimiento de la consulta en dashboard
Validá que los cambios no rompan la integración con Auth0
Corré en paralelo: explorá el memory system y diseñá el proposal
```

**Español sin tilde (tú/usted formal, regional):**
```
Explora el middleware de autenticacion y como maneja tokens de sesion
Investiga por que el cache miss rate esta aumentando
Revisa los cambios en src/services/ para asegurar que sean correctos
Valida que los cambios no rompan la integracion con Auth0
Verifica que los tipos esten bien alineados en el reducer
En background, busca donde se usan las variables deprecadas
Corre en paralelo: explora el memory system y diseña el proposal
```

**English + Spanish mix:**
```
Explora el auth flow y investigate por qué el token expiry está mal
Revisar los tipos en el reducer, validate que todo sea correcto
Check el manejo de errores, analizá el performance en prod
Run in parallel: explorá el cache system y reviewá la API design
```

## Why this exists

Three enforcement layers in one skill:

1. **Model selection** — `ctk model` cannot be skipped
2. **Brief protocol** — sub-agents start with ~500 tok contract vs ~5000 tok re-exploration
3. **MCP preference** — steers agents to `ctk_*` tools instead of Read, saving 60-75% tokens on symbol lookups
