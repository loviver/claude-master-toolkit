# Phase 0 — Capturing real Codex hook payloads

Goal: collect real payloads and a rollout sample so every Codex-side test runs against real data, not against the docs.

## 1. Register the capture hooks

Create `~/.codex/hooks.json` (back up any existing one first). Replace `<REPO>` with the absolute path of this repo.

```json
{
  "hooks": {
    "SessionStart":      [{ "matcher": "startup|resume|clear|compact|fork", "hooks": [{ "type": "command", "command": "bash <REPO>/scripts/capture-hook-payloads.sh codex SessionStart" }] }],
    "UserPromptSubmit":  [{ "hooks": [{ "type": "command", "command": "bash <REPO>/scripts/capture-hook-payloads.sh codex UserPromptSubmit" }] }],
    "PreToolUse":        [{ "hooks": [{ "type": "command", "command": "bash <REPO>/scripts/capture-hook-payloads.sh codex PreToolUse" }] }],
    "PostToolUse":       [{ "hooks": [{ "type": "command", "command": "bash <REPO>/scripts/capture-hook-payloads.sh codex PostToolUse" }] }],
    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "bash <REPO>/scripts/capture-hook-payloads.sh codex PermissionRequest" }] }],
    "PreCompact":        [{ "hooks": [{ "type": "command", "command": "bash <REPO>/scripts/capture-hook-payloads.sh codex PreCompact" }] }],
    "PostCompact":       [{ "hooks": [{ "type": "command", "command": "bash <REPO>/scripts/capture-hook-payloads.sh codex PostCompact" }] }],
    "SubagentStart":     [{ "hooks": [{ "type": "command", "command": "bash <REPO>/scripts/capture-hook-payloads.sh codex SubagentStart" }] }],
    "SubagentStop":      [{ "hooks": [{ "type": "command", "command": "bash <REPO>/scripts/capture-hook-payloads.sh codex SubagentStop" }] }],
    "Stop":              [{ "hooks": [{ "type": "command", "command": "bash <REPO>/scripts/capture-hook-payloads.sh codex Stop" }] }],
    "SessionEnd":        [{ "hooks": [{ "type": "command", "command": "bash <REPO>/scripts/capture-hook-payloads.sh codex SessionEnd" }] }]
  }
}
```

Start Codex, run `/hooks` and **trust** the new hooks (untrusted hooks never run).

## 2. Run the scripted session

In one Codex session, in this order:

1. Ask it to run a shell command (`ls`).
2. Ask it to create and then edit a file (triggers `apply_patch`).
3. Ask it to call any MCP tool (register ctk MCP first: `[mcp_servers.ctk]` in `~/.codex/config.toml`).
4. Ask it to spawn a subagent ("spawn one agent to list the files").
5. Run `/compact`.
6. Let the turn finish (Stop), then exit.
7. `codex resume` the session, send one prompt, exit.
8. Fork the session once (SessionStart `source=fork`).

## 3. Collect

```bash
ls ~/.ctk/captures/codex/                      # one .json + .env per hook call
ls ~/.codex/sessions/$(date +%Y/%m/%d)/        # rollout-*.jsonl
```

Also capture one Claude Code run: register the same script for the Claude events in a scratch `settings.json` with `claude-code` as the first argument.

## 4. Sanitize and commit as fixtures

Remove secrets, tokens, emails and absolute home paths, then copy:

- `~/.ctk/captures/codex/*.json` → `src/hooks/__tests__/fixtures/codex/`
- `~/.ctk/captures/claude-code/*.json` → `src/hooks/__tests__/fixtures/claude-code/`
- one short rollout → `src/shared/sessions/__tests__/fixtures/codex/rollout-sample.jsonl`

## 5. Answer these in `docs/codex-facts.md`

- Skills directory: `~/.agents/skills` or `~/.codex/skills`?
- Does Codex set a session-id env var for hooks / MCP children? (see the `.env` captures)
- Exact `tool_input` shape for `apply_patch`, `exec_command`, `spawn_agent`.
- Rollout fields: `session_meta`, model location, `token_count` shape. Is `session_meta.id` equal to the hook `session_id`?
- Stop output contract (how to force continuation).
- Do `hooks.json` and `[hooks]` in `config.toml` merge or override each other?
