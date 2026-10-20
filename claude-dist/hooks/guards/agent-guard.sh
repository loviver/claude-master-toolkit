#!/usr/bin/env bash
# claude-master-toolkit: Agent PreToolUse guard
# Single responsibility: enforce the /delegate brief protocol.
#
# Persona + skill-registry injection USED to live here but was mis-targeted:
# PreToolUse:Agent's additionalContext lands in the MAIN thread, not the
# sub-agent. It moved to the SubagentStart hook (../subagent-start.sh), which
# injects into the sub-agent's own context.
#
# This gate MUST stay on PreToolUse:Agent because it needs to DENY (exit 2)
# before the sub-agent spawns — SubagentStart cannot block the spawn.
#
# Trusted subagent types (skip the /delegate check entirely):
#   Explore, Plan, claude-code-guide, statusline-setup, sdd-orchestrator
#
# Toggle:
#   CTK_HOOK_AGENT_STRICT=1      block instead of hint on missing brief/model

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

INPUT="$(cat)"
SUBAGENT="$(echo "$INPUT" | jq -r '.tool_input.subagent_type // ""')"
PROMPT="$(echo "$INPUT" | jq -r '.tool_input.prompt // ""')"
MODEL="$(echo "$INPUT" | jq -r '.tool_input.model // ""')"

TRUSTED="Explore|Plan|claude-code-guide|statusline-setup|sdd-orchestrator"
if echo "$SUBAGENT" | grep -qE "^($TRUSTED)$"; then
  exit 0
fi

HAS_BRIEF=0
if echo "$PROMPT" | grep -qE 'ctk_brief_read\(id='; then
  HAS_BRIEF=1
fi

# Brief + model both present → protocol satisfied, nothing to flag.
if [[ "$HAS_BRIEF" -eq 1 && -n "$MODEL" ]]; then
  exit 0
fi

REASON=""
[[ "$HAS_BRIEF" -eq 0 ]] && REASON="missing brief preamble (ctk_brief_read marker not found)"
if [[ -z "$MODEL" ]]; then
  [[ -n "$REASON" ]] && REASON+="; "
  REASON+="model param omitted"
fi

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

jq -n --arg ctx "Agent launched without /delegate protocol ($REASON). Next time prefer /delegate so the brief + model preamble is injected. Non-blocking." '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    additionalContext: $ctx
  }
}'
exit 0
