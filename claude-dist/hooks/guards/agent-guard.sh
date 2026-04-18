#!/usr/bin/env bash
# claude-master-toolkit: Agent PreToolUse guard
# Enforces the /delegate brief protocol. Emits a hint (not a block) when a
# general-purpose sub-agent is launched without the ctk brief preamble.
#
# Trusted subagent types (skip check):
#   Explore, Plan, claude-code-guide, statusline-setup, sdd-orchestrator
#
# Policy: non-blocking by default. To block instead, set
#   CTK_HOOK_AGENT_STRICT=1 in ~/.claude/settings.json.env (or your shell env).

set -euo pipefail

INPUT="$(cat)"
SUBAGENT="$(echo "$INPUT" | jq -r '.tool_input.subagent_type // ""')"
PROMPT="$(echo "$INPUT" | jq -r '.tool_input.prompt // ""')"
MODEL="$(echo "$INPUT" | jq -r '.tool_input.model // ""')"

TRUSTED="Explore|Plan|claude-code-guide|statusline-setup|sdd-orchestrator"
if echo "$SUBAGENT" | grep -qE "^($TRUSTED)$"; then
  exit 0
fi

# Heuristic: the delegate flow injects a "ctk_brief_read" marker into the prompt.
HAS_BRIEF=0
if echo "$PROMPT" | grep -qE 'ctk_brief_read\(id='; then
  HAS_BRIEF=1
fi

# If everything is fine, allow silently.
if [[ "$HAS_BRIEF" -eq 1 && -n "$MODEL" ]]; then
  exit 0
fi

build_reason() {
  local msg=""
  if [[ "$HAS_BRIEF" -eq 0 ]]; then
    msg+="missing brief preamble (ctk_brief_read marker not found)"
  fi
  if [[ -z "$MODEL" ]]; then
    [[ -n "$msg" ]] && msg+="; "
    msg+="model param omitted"
  fi
  echo "$msg"
}

REASON="$(build_reason)"

if [[ "${CTK_HOOK_AGENT_STRICT:-0}" == "1" ]]; then
  cat >&2 <<EOF
✗ Blocked Agent call: $REASON.

Use /delegate <phase> <description> instead. It:
  1. Creates a brief (ctk brief new <id> --task="...")
  2. Resolves model (ctk model <phase>)
  3. Checks context budget (ctk context)
  4. Injects the mini-DSL preamble into the sub-agent prompt

Skill reference: ~/.claude/skills/delegate/SKILL.md
EOF
  exit 2
fi

# Non-strict: allow + warn via additionalContext (shown to Claude, not user).
jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    additionalContext: ("Agent launched without /delegate protocol (" + $reason + "). Next time prefer /delegate so the brief + model preamble is injected. Non-blocking.")
  }
}'
exit 0
