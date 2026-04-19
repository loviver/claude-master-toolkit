# CTK Phase 0 — Stack Reinforcement Plan

**Status:** Draft / Ready to start
**Depends on:** nothing. This runs **before** `docs/pandorica-v2-mem-tools-plan.md` (Phase A).
**Source material:** extracted from `../gentle-ai` before deletion. All patterns captured here so the original repo can be removed safely.
**Last updated:** 2026-04-18

---

## 1. Problem being solved

The current `ctk` stack is **infrastructurally present but behaviorally inactive**:

- `ctk` commands never auto-run (user must invoke manually)
- `pandorica_save` is rarely called — memories barely grow
- Sub-agents never spawn — `Agent` / `/delegate` unused
- Skills exist in `claude-dist/skills/` but don't auto-load per context
- Guardian hooks warn but do not enforce
- Agent loops run 20–32 micro-steps on Haiku without planning (see cost-trace analysis session 2026-04-18)

Phase A (Pandorica v2, 15 `mem_*` tools, FTS5) upgrades storage but does **not** solve adoption. Adoption needs:

1. Auto-bootstrapping (`ctk init` on first project contact)
2. A skill registry the orchestrator reads at session start
3. A dedicated orchestrator that delegates instead of executing inline
4. 10 specialized sub-agents for SDD phases
5. A pipeline runner with rollback
6. A planner with dependency graph + topological resolve
7. Persona injection into every sub-agent
8. Hard enforcement hooks (not just reminders)
9. Max-step caps and explicit done conditions

---

## 2. Architecture we are importing from gentle-ai (captured before deletion)

### 2.1 Ten-sub-agent SDD system

Each agent is a focused executor for one SDD phase. The **orchestrator** never executes directly; it delegates everything to these:

| Sub-agent | Role | Readonly? | Recommended model |
|---|---|---|---|
| `sdd-init` | Detects stack, testing capabilities, activates Strict TDD when available. Must run once per new project before any other SDD command. | no (writes context) | haiku |
| `sdd-onboard` | Guided end-to-end walkthrough of SDD using the real codebase. | no | sonnet |
| `sdd-explore` | Investigates a topic or idea before any proposal. Reads codebase, compares approaches, returns analysis with recommendation. Creates no project files. | no (terminal + MCP access) | opus |
| `sdd-propose` | Takes `sdd-explore` output and writes a concrete proposal artifact. | no | opus |
| `sdd-spec` | Writes the functional/behavioral spec for the proposed change. | no | sonnet |
| `sdd-design` | Architectural design doc: modules affected, interfaces, data flow, tradeoffs. | no | opus |
| `sdd-tasks` | Breaks the design into an ordered task list with dependencies and acceptance criteria. | no | sonnet |
| `sdd-apply` | Implements tasks in batches. Reads spec/design/tasks, respects TDD mode (RED → GREEN → REFACTOR), marks `[x]` as it goes. | no | sonnet (haiku if purely mechanical) |
| `sdd-verify` | Runs tests, checks implementation against spec, classifies findings as CRITICAL / WARNING / SUGGESTION. | no (terminal) | sonnet |
| `sdd-archive` | Closes the change, persists final state in the artifact store, consolidates memories. | no | haiku |

### 2.2 Orchestrator contract

The orchestrator is a **coordinator, not an executor**. Its single job is deciding whether to do a thing inline or delegate. Import the delegation table verbatim:

| Action | Inline | Delegate |
|---|---|---|
| Read to decide/verify (1–3 files) | ✅ | — |
| Read to explore/understand (4+ files) | — | ✅ |
| Read as preparation for writing | — | ✅ together with the write |
| Write atomic (one file, mechanical, you already know what) | ✅ | — |
| Write with analysis (multiple files, new logic) | — | ✅ |
| Bash for state (git, gh) | ✅ | — |
| Bash for execution (test, build, install) | — | ✅ |

Core principle: *does this inflate my context without need?* If yes → delegate. If no → inline.

### 2.3 Artifact store policy

Every phase persists its artifacts to one of:

- `pandorica` — default when available; persistent memory across sessions (our replacement for engram)
- `openspec` — file-based artifacts in `openspec/`; use only when user explicitly requests
- `hybrid` — both backends; cross-session recovery + local files; more tokens per op
- `none` — inline results only; orchestrator should recommend enabling pandorica

### 2.4 Result contract (every sub-agent returns this shape)

```
status: "done" | "blocked" | "partial"
executive_summary: string (one sentence)
artifacts: string[]   # topic_keys or file paths written
next_recommended: string   # name of next phase, or "none"
risks: string[]
skill_resolution: "injected" | "registry" | "none"
```

### 2.5 Pipeline runner (from `gentle-ai/internal/pipeline/`)

A minimal 3-stage runner with rollback:

```ts
// src/cli/pipeline/stages.ts
export type Stage = "prepare" | "apply" | "rollback";

export interface Step {
  id(): string;
  run(): Promise<void>;
}

export interface RollbackStep extends Step {
  rollback(): Promise<void>;
}

export type FailurePolicy = "stop-on-error" | "continue-on-error";

export interface StagePlan {
  prepare: Step[];
  apply: Step[];
}

export interface ProgressEvent {
  stepId: string;
  stage: Stage;
  status: "running" | "ok" | "failed";
  err?: Error;
}
```

Orchestrator execution loop:

1. Run all `prepare` steps. If any fails → abort, return result.
2. Run all `apply` steps. If any fails → rollback the steps that already completed (in reverse order), return result.
3. Emit a `ProgressEvent` per step transition so the TUI/CLI can stream progress.

### 2.6 Planner graph (from `gentle-ai/internal/planner/`)

Dependency-aware install/execute planner:

- `Graph` holds `map<ComponentID, ComponentID[]>` of hard deps.
- `Resolver.Resolve(selection)` → `ResolvedPlan` with `OrderedComponents`, `AddedDependencies`, `Agents`, `UnsupportedAgents`.
- Uses **topological sort** for strict order.
- Applies **soft-ordering pairs**: when both `A` and `B` are selected, ensure `A` runs before `B` even though there's no hard dep. Example from gentle-ai: `{persona, engram}` — persona must write the base file before engram appends to it.

For ctk we will seed the graph with:

```
pandorica:       []
sdd:             [pandorica]
skills:          [sdd]
persona:         []
hooks:           [pandorica]
model-routing:   []
```

Soft-ordering: `{persona, pandorica}`, `{persona, sdd}` (persona writes the base prompt file, others append).

### 2.7 Agent adapter interface (from `gentle-ai/internal/agents/interface.go`)

This is how we stay agent-agnostic without switch statements everywhere. Initial ctk scope is Claude-first, but the adapter makes expansion trivial.

```ts
// src/cli/agents/interface.ts
export interface AgentAdapter {
  // identity
  agent(): AgentId;
  tier(): SupportTier;

  // detection
  detect(homeDir: string): Promise<{
    installed: boolean;
    binaryPath?: string;
    configPath?: string;
    configFound: boolean;
  }>;

  // installation
  supportsAutoInstall(): boolean;
  installCommand(profile: PlatformProfile): string[][];

  // config paths
  globalConfigDir(homeDir: string): string;
  systemPromptDir(homeDir: string): string;
  systemPromptFile(homeDir: string): string;
  skillsDir(homeDir: string): string;
  settingsPath(homeDir: string): string;

  // strategies (HOW to inject, not WHERE)
  systemPromptStrategy(): "replace" | "append" | "file-replace";
  mcpStrategy(): "json" | "toml" | "yaml";
  mcpConfigPath(homeDir: string, serverName: string): string;

  // capabilities
  supportsOutputStyles(): boolean;
  outputStyleDir(homeDir: string): string;
  supportsSlashCommands(): boolean;
  commandsDir(homeDir: string): string;
  supportsSkills(): boolean;
  supportsSystemPrompt(): boolean;
  supportsMCP(): boolean;
}
```

Initial implementation: `ClaudeCodeAdapter`. Stub the others (`OpenCodeAdapter`, `CursorAdapter`) so the interface is validated, but do not ship them fully in Phase 0.

---

## 3. New `ctk` commands to build

### 3.1 `ctk init`

Runs once per project. Idempotent.

1. Detect stack by scanning for manifest files (`package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, etc.).
2. Detect test framework (`vitest`, `jest`, `go test`, `pytest`, `cargo test`).
3. If a test framework is present, activate **Strict TDD Mode** by writing a flag to `.ctk/project-context.md`.
4. Write `.ctk/project-context.md` with: stack, test framework, TDD status, detected conventions files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`).
5. Persist a `pandorica_save({ topic_key: "ctk-init/{project}", type: "reference", ... })` so the orchestrator can detect "init ran" by searching memory.
6. If `pandorica` is unavailable, fall back to `.ctk/init.marker` file.

### 3.2 `ctk skill-registry`

Scans all skill sources and produces a single index.

1. Source directories: `~/.claude/skills/`, `claude-dist/skills/`, project-level skills dir, and any project conventions files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`).
2. Parse frontmatter from each `SKILL.md` (`name`, `description`, `triggers`, `tags`).
3. Write `.ctk/skill-registry.md` with a table: name | triggers | path | summary.
4. Also save into pandorica: `pandorica_save({ topic_key: "skill-registry/{project}", type: "reference" })`.
5. Re-run when skills change. A future skill-creator skill can wire this to auto-run after skill edits.

### 3.3 `ctk orchestrate <task>`

Launches the pipeline orchestrator for a named task. Reads `.ctk/project-context.md`, checks if `ctk init` ran, decides the SDD phase to enter (new task → `sdd-explore`, continuing task → next dependency-ready phase).

### 3.4 `ctk plan <task>`

Builds a dependency graph for a task without executing, prints the resolved topological order. Debug/inspection tool.

### 3.5 `ctk persona inject`

Writes the `CLAUDE.md` persona block into every sub-agent prompt during install. Called by `ctk install claude`.

---

## 4. Hooks rewrite (enforcement, not reminders)

Current hooks warn. New hooks **block or mutate behavior** at the right points.

### 4.1 `UserPromptSubmit`

Existing: context-window threshold warnings. Keep.

Add: if the prompt matches a `sdd-*` command pattern and `.ctk/project-context.md` is missing → auto-inject a system message "`ctk init` required — running now" and invoke `sdd-init` before continuing.

### 4.2 `PreToolUse: Edit` / `PreToolUse: Write`

Before any edit, ensure:

- persona is already in context (load from `.ctk/persona.md` if missing)
- skill-registry is loaded (read `.ctk/skill-registry.md` if missing)
- if the file being edited matches a skill trigger pattern, inject the skill content into context

### 4.3 `PostToolUse: Edit` / `PostToolUse: Write`

Counter-based. After every 3 Edits/Writes without a `pandorica_save` (or `mem_save` post-Phase-A), **emit a blocking reminder** ("you must save context before continuing"). Current Stop hook only emits a soft reminder — this promotes it.

### 4.4 `PreToolUse: Agent` / `PreToolUse: Task`

Inject the persona block into the sub-agent's system prompt. Inject a pointer to `.ctk/skill-registry.md`. Without these, sub-agents start cold and don't use the stack.

### 4.5 Existing hooks kept

- `PreToolUse: Bash` — block AI attribution in `git commit` (unchanged)
- `PreCompact` — remind to call `pandorica_session_summary` (unchanged)
- `SessionStart` — warn if prior session >60% window (unchanged)

---

## 5. Agent loop guardrails

### 5.1 Max-steps cap

Cap any single agent invocation at **10 tool calls by default** (configurable via `CTK_AGENT_MAX_STEPS`). When the cap is reached:

1. Inject a system message: "you've reached the step cap. Call `pandorica_save` with session summary and return."
2. If the agent still tries to call a tool, force stop and return partial result with `status: "partial"`.

### 5.2 Explicit done condition

Sub-agents must return the Result Contract shape (§2.4). The orchestrator parses it and will not re-invoke the same sub-agent unless `status: "partial"` and the same `next_recommended` is still valid.

### 5.3 Model routing integration

Before invoking a sub-agent, the orchestrator runs `ctk model <phase>` (already built) and sets the sub-agent's model accordingly. Defaults:

- `sdd-explore`, `sdd-propose`, `sdd-design` → opus
- `sdd-spec`, `sdd-tasks`, `sdd-apply`, `sdd-verify`, `sdd-onboard` → sonnet
- `sdd-init`, `sdd-archive` → haiku

---

## 6. Persona injection

Today the persona lives in `CLAUDE.md` at the repo root and in `~/.claude/CLAUDE.md` globally. It loads into the main conversation but **not into sub-agents** spawned via the `Agent` tool.

Fix:

1. Extract the persona block into `claude-dist/persona.md` (new file).
2. During `ctk install claude`, write it to `~/.claude/persona.md`.
3. The `PreToolUse: Agent` hook reads `~/.claude/persona.md` and prepends it to the sub-agent's prompt.
4. The SDD orchestrator skill reads the same file and includes it in every delegation.

Result: every sub-agent carries the Senior Architect persona. Consistent behavior.

---

## 7. SDD Init Guard (mandatory)

Imported verbatim from gentle-ai orchestrator. Before any `sdd-*` command runs:

1. Search pandorica: `mem_search({ query: "sdd-init/{project}", project })`.
2. If found → proceed.
3. If not → run `sdd-init` sub-agent silently, then proceed.

This guarantees every SDD command has project context, TDD status, and skill registry resolved.

---

## 8. Execution modes

For `/sdd-new`, `/sdd-ff`, `/sdd-continue` — ask once per session:

- **Automatic (`auto`)** — run all phases back-to-back, final result only.
- **Interactive (`interactive`)** — pause after each phase, summary + "adjust or continue?".

Remember the choice in pandorica for the session.

---

## 9. Optional: Agent Builder (nice-to-have, not Phase 0 blocker)

gentle-ai has an "Agent Builder" TUI that generates custom sub-agents from natural-language descriptions. Key types captured below for future port:

```ts
type SDDIntegrationMode = "standalone" | "new-phase" | "phase-support";

interface SDDIntegration {
  mode: SDDIntegrationMode;
  targetPhase: string;
  phaseName?: string;
}

interface GeneratedAgent {
  name: string;
  title: string;
  description: string;
  trigger: string;
  content: string;
  sddConfig?: SDDIntegration;
}

interface RegistryEntry {
  name: string;
  title: string;
  description: string;
  createdAt: string;
  generationEngine: AgentId;
  sddIntegration?: SDDIntegration;
  installedAgents: AgentId[];
}
```

Defer to Phase 2 (after Phase 0 + Phase A land).

---

## 10. Phase breakdown (implementation order)

### Phase 0.1 — Foundations (read-only, wiring)

1. Create `.ctk/` directory structure: `project-context.md`, `skill-registry.md`, `persona.md`, `init.marker`, `session.json`.
2. Build `ctk init` command.
3. Build `ctk skill-registry` command.
4. Extract persona → `claude-dist/persona.md`.

### Phase 0.2 — Pipeline + planner

5. Port pipeline runner to `src/cli/pipeline/` (stages, step, rollback, progress).
6. Port planner graph + resolver to `src/cli/planner/` (graph, topo sort, soft ordering).
7. Build `ctk plan <task>` and `ctk orchestrate <task>`.

### Phase 0.3 — Ten sub-agents

8. Write `claude-dist/agents/sdd-{init,onboard,explore,propose,spec,design,tasks,apply,verify,archive}.md` using the Result Contract shape.
9. Rewrite `claude-dist/agents/sdd-orchestrator.md` using the delegation table + artifact store policy + SDD Init Guard from §2.
10. Register them in `settings.patch.json` so `ctk install claude` symlinks them into `~/.claude/agents/`.

### Phase 0.4 — Hooks enforcement

11. Rewrite guardian hooks per §4 (enforcement, not reminders).
12. Add `PreToolUse: Agent` persona injection.
13. Add max-steps cap per §5.

### Phase 0.5 — Adapter scaffolding

14. Define `AgentAdapter` interface (§2.7).
15. Implement `ClaudeCodeAdapter` fully.
16. Stub `OpenCodeAdapter`, `CursorAdapter`, `CodexAdapter` (interface satisfied, bodies return `notSupported` errors). Validates the abstraction without overscoping.

### Phase 0.6 — Docs + validation

17. Update root `CLAUDE.md` to reference the new commands and behavior.
18. Add `docs/intended-usage.md` (equivalent of gentle-ai's — explains the mental model, not flags).
19. End-to-end test: fresh project, run `ctk init`, run a `/sdd-explore` command, verify orchestrator → sub-agent → pandorica save.

**Phase 0 exit criteria:**

- `ctk init` auto-detects stack on a fresh clone.
- `ctk skill-registry` produces a readable index.
- `/sdd-new` spawns `sdd-explore` with persona injected, receives a Result-Contract-shaped response, saves to pandorica.
- Hooks block (not just warn) when stack tools are bypassed.
- 10 sub-agents registered and routable by model per §5.3.

---

## 11. Open questions (confirm before starting)

1. **Adapter scope** — user confirmed we are not porting gentle-ai's 10 agent adapters, but the interface itself is useful. Ship interface + Claude only? Default: yes.
2. **Hook strictness** — current plan makes `PostToolUse` block after 3 edits without a save. Too aggressive? Make threshold configurable via `CTK_HOOK_SAVE_THRESHOLD`, default 3.
3. **Agent Builder** — defer to Phase 2, confirmed.
4. **Openspec artifact store** — keep as a supported backend alongside pandorica, or drop? Gentle-ai supports it. Ctk has no current openspec integration. Default: drop for Phase 0, revisit if user requests.

---

## 12. Handoff notes

- User writes in Spanish. Respond in Spanish. Caveman mode is on by default.
- No AI attribution in commits. Enforced by pre-commit hook.
- Strict TDD globally enabled — write failing tests first for every new command.
- Use `/delegate`, not raw `Agent`. `ctk model <phase>` mandatory before delegation.
- This plan presumes `../gentle-ai` will be deleted. Everything needed is either captured here or reproducible from gentle-ai's public repo: `github.com/Gentleman-Programming/gentle-ai`.
- Sister plan: `docs/pandorica-v2-mem-tools-plan.md`. Phase 0 lands first so Phase A has a populated stack to validate against.

---

## 13. Relationship between Phase 0 and Phase A (Pandorica v2)

```
Phase 0 (this doc)                    Phase A (pandorica-v2 doc)
─────────────────                     ──────────────────────────
ctk init                              memories_v2 schema
skill-registry                        FTS5 virtual table
pipeline runner                       15 mem_* tool handlers
planner graph                         backward compat shim
10 sub-agents                         memory_searches table
orchestrator rewrite                  access_count tracking
hooks enforcement                     cost enrichment fields
persona injection                     Phase B rewire (later)
max-step caps                         Phase C engram alias (later)
```

Phase 0 makes the stack **active**. Phase A makes memory **structured and searchable**. Together they form the base for Phase B (wire skills to call `mem_save` with full fields) and Phase C (expose engram-compatible alias layer so non-Claude agents can consume pandorica as memory backend).
