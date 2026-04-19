#!/usr/bin/env bash
# claude-master-toolkit: Agent PreToolUse guard
# Responsibilities:
#   1. Enforce /delegate brief protocol (hint or block per CTK_HOOK_AGENT_STRICT)
#   2. Inject persona block (~/.claude/persona.md) into sub-agent context
#   3. Inject skill-registry pointer (.ctk/skill-registry.md) into sub-agent context
#
# Trusted subagent types (skip /delegate check, still inject persona/registry):
#   Explore, Plan, claude-code-guide, statusline-setup, sdd-orchestrator
#
# Toggles:
#   CTK_HOOK_AGENT_STRICT=1      block instead of hint on missing brief
#   CTK_HOOK_PERSONA_INJECT=0    skip persona injection
#   CTK_HOOK_REGISTRY_INJECT=0   skip registry injection

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

INPUT="$(cat)"
SUBAGENT="$(echo "$INPUT" | jq -r '.tool_input.subagent_type // ""')"
PROMPT="$(echo "$INPUT" | jq -r '.tool_input.prompt // ""')"
MODEL="$(echo "$INPUT" | jq -r '.tool_input.model // ""')"

TRUSTED="Explore|Plan|claude-code-guide|statusline-setup|sdd-orchestrator"
IS_TRUSTED=0
if echo "$SUBAGENT" | grep -qE "^($TRUSTED)$"; then
  IS_TRUSTED=1
fi

HAS_BRIEF=0
if echo "$PROMPT" | grep -qE 'ctk_brief_read\(id='; then
  HAS_BRIEF=1
fi

# Build injection block (persona + registry pointer).
build_injection() {
  local block=""
  if [[ "${CTK_HOOK_PERSONA_INJECT:-1}" != "0" ]]; then
    local persona
    persona="$(ctk_lib_read_persona)"
    if [[ -n "$persona" ]]; then
      block+="[ctk-persona]"$'\n'"$persona"$'\n\n'
    fi
  fi
  if [[ "${CTK_HOOK_REGISTRY_INJECT:-1}" != "0" ]]; then
    local registry
    registry="$(ctk_lib_read_skill_registry)"
    if [[ -n "$registry" ]]; then
      block+="[ctk-skills] registry at .ctk/skill-registry.md"$'\n'"$registry"$'\n'
    fi
  fi
  printf '%s' "$block"
}

INJECTION="$(build_injection)"

# Strict-mode block path: only for non-trusted agents missing brief/model.
if [[ "$IS_TRUSTED" -eq 0 && ( "$HAS_BRIEF" -eq 0 || -z "$MODEL" ) ]]; then
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

  CONTEXT_MSG="Agent launched without /delegate protocol ($REASON). Next time prefer /delegate so the brief + model preamble is injected. Non-blocking."
  if [[ -n "$INJECTION" ]]; then
    CONTEXT_MSG+=$'\n\n'"$INJECTION"
  fi
  jq -n --arg ctx "$CONTEXT_MSG" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: $ctx
    }
  }'
  exit 0
fi

# Trusted path OR brief+model present: allow. Still inject persona/registry.
if [[ -n "$INJECTION" ]]; then
  jq -n --arg ctx "$INJECTION" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: $ctx
    }
  }'
else
  exit 0
fi
