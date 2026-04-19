# ctk — Intended Usage

Mental model for the Claude Master Toolkit. Flags and CLI reference live in `CLAUDE.md` and `--help` output. This doc explains **why** the pieces exist and **how** they compose.

## 1. Why ctk exists

The Claude Code harness ships with hooks, skills, sub-agents, and MCP tools, but adoption is the bottleneck:

- Sub-agents don't spawn unless something pushes for delegation.
- `pandorica_save` is rarely called — memory stays empty.
- Skills sit in `~/.claude/skills/` but never auto-load.
- Hooks warn without enforcing.

ctk closes the adoption gap: a thin CLI + bash hooks + TS runner that makes the stack **active by default**. Read `docs/ctk-phase0-reinforce-plan.md` for the full rationale.

## 2. Typical flow

```
fresh clone → ctk init  ──►  Strict TDD detected, .ctk/project-context.md + init.marker written
                             pandorica memory saved: "ctk-init/<project>"

             /sdd-new X  ──►  UserPromptSubmit hook checks init.marker (present, proceed)
                              sdd-orchestrator spawned (persona + skill-registry injected)
                                │
                                ├─ sdd-explore  (opus)       → findings pool
                                ├─ sdd-propose  (opus)       → proposal artifact
                                ├─ sdd-spec     (sonnet)     → functional spec
                                ├─ sdd-design   (opus)       → architecture doc
                                ├─ sdd-tasks    (sonnet)     → ordered task list
                                ├─ sdd-apply    (sonnet)     → TDD loop (RED → GREEN → REFACTOR)
                                ├─ sdd-verify   (sonnet)     → classify findings
                                └─ sdd-archive  (haiku)      → close + persist
                              each phase → pandorica save → next dependency-ready phase
```

## 3. Who does what

| Layer | Role | Never does |
|---|---|---|
| Main conversation | Decides scope, confirms plans, reviews artifacts. | Execute heavy reads/writes inline. |
| `sdd-orchestrator` sub-agent | Coordinator. Picks phase, resolves model (`ctk model`), enforces SDD Init Guard, delegates. | Execute phase work itself. |
| SDD phase sub-agents | Focused executors. Return the Result Contract shape (§2.4 of the plan). | Skip `pandorica_save`. |
| Hooks | Enforce: persona inject, init-marker check, save threshold, skill hints. | Silently swallow errors. |
| `ctk pandorica` | Durable memory. Invoked by skills, sub-agents, and the CLI. | Store ephemeral task state. |

Delegation rule of thumb: *does this inflate my context without need?* → delegate. Else inline. See the delegation table in the Phase 0 plan §2.2.

## 4. Memory — when to save, how to search

Save proactively after any of: decision, bugfix, convention discovered, user preference, surprising finding. **Don't** save task state — that's what tasks/plans are for.

- `mem_save` / `pandorica_save` — write (v2 has 15 `mem_*` verbs with FTS5 + cost correlation)
- `mem_recall` / `pandorica_search` — read
- `mem_session({ action: 'summary' })` — before `/compact`

Every sub-agent is expected to save at least once per non-trivial run. The Stop hook enforces this at the session level (see §5).

## 5. What the hooks do

| Hook | Behavior | Toggle |
|---|---|---|
| `SessionStart` | Warns if prior session in this cwd used >60% window; reminds of ctk MCP tools; purges stale state >7 days. | — |
| `UserPromptSubmit` | 70/85/95% context warnings + **sdd-init guard**: on `/sdd-*` without `.ctk/init.marker` emits init-required hint. | `$CLAUDE_CONTEXT_WINDOW` |
| `PreToolUse:Bash` | Blocks `git commit` carrying AI attribution. | — |
| `PreToolUse:Agent` | Injects persona + skill-registry pointer; hints missing `/delegate` preamble. | `CTK_HOOK_AGENT_STRICT`, `CTK_HOOK_PERSONA_INJECT`, `CTK_HOOK_REGISTRY_INJECT` |
| `PreToolUse:Edit\|Write\|MultiEdit` | Emits `[ctk-skill-hint] load <name>` when target path matches a registry trigger. | `CTK_HOOK_EDIT_SKILL_INJECT` |
| `Stop` | If Edits ≥ threshold and zero saves, reminds (soft) or blocks (strict). | `CTK_HOOK_SAVE_THRESHOLD` (default 3), `CTK_HOOK_SAVE_STRICT=1` |
| `PreCompact` | Reminds to call `mem_session({ action: 'summary' })` before compaction. | — |

All hooks share `claude-dist/hooks/lib.sh` (helpers: context math, persona/registry readers, counters, state dir).

## 6. Known limits

- **Hard per-tool-call caps inside sub-agents** are not enforceable with current Claude Code hook granularity. `src/cli/lib/agent-budget.ts` records counters; orchestrator prompt enforces soft. Revisit when the harness exposes `PreToolUse` inside a running sub-agent.
- **Non-Claude adapters** (`opencode`, `cursor`, `codex`) are stubs. The interface is validated; full implementations land in Phase 2.
- **Openspec artifact store** dropped for Phase 0. Pandorica is the only supported memory backend.

## 7. Recovery paths

- Lost context mid-session → `/compact` if coherent, `/clear` if the next task is unrelated. Cache TTL (5 min) is NOT context expiry.
- Hook warns but you need to push past → set the toggle env var, don't skip the hook.
- Stale `.ctk/init.marker` → delete + `ctk init` again. Idempotent.

## 8. Related docs

- `docs/ctk-phase0-reinforce-plan.md` — full spec for Phase 0 (this doc is the summary).
- `docs/pandorica-v2-mem-tools-plan.md` — memory backend evolution.
- `CLAUDE.md` (root) — command reference + hook env toggles.
- `~/.claude/CLAUDE.md` — global persona + skill routing table.
