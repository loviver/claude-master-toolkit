# Codex facts (verified against Codex CLI 0.164.0, captured 2026-10-26)

Fixtures: `src/hooks/__tests__/fixtures/codex/`, `src/shared/sessions/__tests__/fixtures/codex/rollout-sample.jsonl`.

## Verified
- `~/.codex/hooks.json` hooks run after trust via `/hooks`; trust is recorded in `config.toml` under `[hooks.state."<path>:<event>:0:0"]` — **ctk must never rewrite those tables** when merging TOML.
- Hook stdin common fields: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`; `turn_id` on everything except SessionStart. `source` on SessionStart (`startup`).
- `PreToolUse`/`PostToolUse`: shell calls arrive as `tool_name: "Bash"`, `tool_input.command`, `tool_use_id: "exec-<uuid>"`; `tool_response` is a **plain string** (Claude: object).
- `UserPromptSubmit.prompt`; `Stop` has `stop_hook_active`, `last_assistant_message`.
- Hook `session_id` == rollout `session_meta.payload.id` (bare UUID, no prefix). `transcript_path` is the rollout file.
- **No session-id env var** is exported to hook children (only `CODEX_MANAGED_BY_NPM`, `CODEX_MANAGED_PACKAGE_ROOT`). CLI/MCP code cannot read the session from env; hooks must persist it (keyed by cwd) for ctk MCP to read. `CodexAdapter.sessionIdEnv()` is `null`.
- Skills dir `~/.codex/skills` exists (`~/.agents` does not).
- Rollout line types: `session_meta`, `turn_context`, `event_msg` (`task_started`, `token_count`, `item_completed`, `task_complete`, `thread_settings_applied`), `response_item` (`message`, `reasoning`, `custom_tool_call`, `custom_tool_call_output`, `additional_tools`), `token_usage_record`, `world_state`.
- `token_count.info`: `total_token_usage` / `last_token_usage` {`input_tokens` (includes `cached_input_tokens`), `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`}, plus `model_context_window` (258400 for `gpt-6-luna`).
- Model ids are not `gpt-5*`: observed `gpt-6-luna` → pricing/registry must treat unknown models as unknown, never as sonnet.

## Verified (scripted session in a scratch repo)
- **Codex edits files through Bash** (`printf 'hola' > a.txt`), not necessarily `apply_patch`: a plain "create/edit a file" prompt produced only `tool_name: "Bash"` payloads. Edit-based guards (skill hint, reindex) cannot rely on `apply_patch` appearing; they must also inspect Bash commands, or the test prompt must demand `apply_patch` explicitly.
- **Subagent spawn tool name is `collaborationspawn_agent`** (not `spawn_agent`/`Agent`). `tool_input` = `{task_name, fork_turns, message}`; `message` is **encrypted** (`gAAAA...`), so the /delegate brief-preamble hint can never inspect it on Codex. `tool_response` = JSON string `{"task_name":"/root/<name>"}`.
- Hooks fired inside a subagent carry extra `agent_id` and `agent_type` (`default`); main-thread payloads do not.
- `SubagentStart`: `session_id, turn_id, agent_id, agent_type`. `SubagentStop`: same + `agent_transcript_path` (the subagent's own rollout) + `stop_hook_active` + `last_assistant_message`.
- `PreCompact` / `PostCompact`: `trigger: "manual"` (same field Claude uses).
- `SessionEnd`: `reason` always `"other"`, and it fired **more than once for the same session** (once per exit/resume) — handlers must be idempotent.
- `SessionStart.source`: `startup`, `resume` observed. `fork` did **not** emit a SessionStart; the forked session only produced SessionEnd.
- Subagents have their own rollout/session id (`agent_id` is the rollout uuid).

## Still open
- `apply_patch` `tool_input` shape (rerun with a prompt that forces `apply_patch`).
- MCP tool-call payload (`mcp__server__tool`) — needs `[mcp_servers.*]` registered.
- `PermissionRequest` payload (needs an approval-requiring command).
- Stop-continuation output contract; `hooks.json` vs `[hooks]` merge behaviour.

## From the official docs (not yet exercised on a live Codex)
- **MCP**: `[mcp_servers.<name>]` in `~/.codex/config.toml` (`command`, `args`, `env`, `startup_timeout_sec`, `enabled`, `required`); `codex mcp add` exists. ctk writes a managed block (`# >>> ctk:mcp ... <<<`) instead of re-serializing the file, so comments and `[hooks.state.*]` survive byte-for-byte.
- **Custom subagents**: one TOML per agent in `~/.codex/agents/`; required `name`, `description`, `developer_instructions`; `model` optional. `sandbox_mode`, `approval_policy`, `model_provider` and `mcp_servers` in an agent file do **not** override the parent, so MCP must be registered in the parent `config.toml`.
- **AGENTS.md**: global file is `~/.codex/AGENTS.md`; `AGENTS.override.md` (if present) wins and AGENTS.md is then ignored. Whole instruction chain is capped at `project_doc_max_bytes` (32 KiB default).
- `ctk install codex` (Phase 5) installs MCP + the neutral skills only. Agents (`render-agent.ts` is ready and tested) and AGENTS.md wait for Phase 8; hooks.json registration waits for the Phase 6 Codex normalizer.

## Hook output contract (official hooks doc, https://developers.openai.com/codex/hooks; Phase 6 renderer)
Not yet exercised on a live Codex run: re-check after the first real session with ctk hooks trusted.
- **PreToolUse**: deny = exit 2 + stderr (or `hookSpecificOutput.permissionDecision: "deny"`). `ask` is parsed but unsupported (hook marked failed, call continues). `allow` only with `updatedInput`. `additionalContext` supported.
- **Stop**: exit 0 needs JSON on stdout (plain text is invalid). `decision: "block"` / exit 2 + stderr does NOT reject the turn: Codex starts a continuation prompt using the reason.
- **SessionStart / UserPromptSubmit / SubagentStart**: plain stdout = developer context. **PostToolUse**: plain stdout ignored, JSON `additionalContext`. **PreCompact**: no `additionalContext`, only common fields (`systemMessage`, ...). **UserPromptSubmit** blocks with `{"decision":"block","reason"}`.
- `hooks.json`: `{ "hooks": { "<Event>": [ { "matcher"?, "hooks": [ { "type": "command", "command", "timeout"?, "statusMessage"? } ] } ] } }`; default timeout 600s, SessionEnd 1s (max 3).
- Docs say matchers use `Bash`, `apply_patch` (alias `Edit`/`Write`), `mcp__<server>__<tool>`, and `spawn_agent` (alias `Agent`); our capture shows the spawn tool is really `collaborationspawn_agent`, so ctk only relies on captured names.

## Phase 6 decisions
- Registered on Codex: SessionStart, UserPromptSubmit, PreToolUse(Bash), PostToolUse(Bash), Stop, SessionEnd.
- Deliberate noops (no verified contract or no usable data): `apply_patch` (classified `other`, no paths), MCP calls (`mcp`, no guard acts), `PermissionRequest` (never normalized), subagent spawn (message encrypted: no /delegate hint), PreCompact reminder, SubagentStart/Stop.
- Codex edits through Bash, so skill hints and reindex use `src/hooks/lib/shell-writes.ts` (`>` `>>` `>|` `&>`, `tee`, `sed -i`, `bash -c`). Not covered: `cp`, `mv`, `install`, `perl -i`, `python -c`, `git apply/checkout`, variable/command-substitution targets.
- Until Phase 7 (rollout parser): no session sync and no edit/save nag on Codex; the context warning reads `token_count.last_token_usage.total_tokens` and Codex's own `model_context_window`.
- Still open: persisting the Codex session id (keyed by cwd) for the MCP server (no env var, and whether the MCP process cwd equals the session cwd is unverified); captures for `apply_patch`, MCP, `PermissionRequest`.

## MCP latency (measured 2026-10-26 against a 1.39 GB `ctk.sqlite`, boxful-admin index)
Measured locally with a stdio JSON-RPC client against the real `dist/mcp.js`, not from inside Codex.
- **Warm calls are fast**: `ctk_find` / `understand` / `callers` / `deps` take 1-11 ms end to end (50 consecutive finds: ~2.5 ms avg with a connection per call, ~1 ms with the shared connection).
- **Cold start was the slow part**: 500-690 ms to answer `initialize`, ~257 ms of it from `drizzle-orm`, pulled in by `workflow-tools` (only the `wf_*` tools use it). Now lazy-loaded via a split chunk: ~225 ms.
  - Needs `splitting: true` on the `mcp` entry in `tsup.config.ts`, otherwise the bundler hoists drizzle's static import back to the top of `dist/mcp.js`. Chunks are emitted next to `mcp.js`; `files: ["dist"]` already ships them.
- **Write contention is bounded**: with a process holding 30k-row `BEGIN IMMEDIATE` transactions on the same DB, opening a connection per call peaked at ~215 ms (vs ~12-15 ms idle). Never seconds. The MCP server now keeps one connection for its lifetime.
- **Not explained by ctk**: the 32.8 s / 46.0 s `ctk_understand("formatCurrency")` calls from the benchmark. Query and lock costs measured here are 2-3 orders of magnitude lower, so the cost is outside the query layer (Codex's MCP transport, a per-call server spawn, or its sandbox). To confirm from inside Codex, run with `CTK_MCP_TRACE=1` (stderr, one line per call):
  `[ctk-mcp:trace] {"tool":"ctk_find","ms":15.1,"openMs":3.5,"reused":false,"queryMs":11.6,"bytes":1821}`
  If `ms` is small but Codex reports seconds, the time is in the host. If `reused` is always `false`, Codex spawns a server per call.
- Gotcha: v3 index code against an existing `~/.ctk` wipes every project's index (schema version bump), and the old `dist` wipes it back. Rebuild `dist`, then reindex all projects.
