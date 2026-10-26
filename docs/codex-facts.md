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
