#!/usr/bin/env bash
# claude-master-toolkit: SubagentStart hook
# Fires when a sub-agent is spawned. Injects persona + skill-registry into the
# SUB-AGENT's context. This is the correct target: PreToolUse:Agent's
# additionalContext lands in the MAIN thread (which already has the persona via
# CLAUDE.md), NOT in the cold sub-agent that actually needs it.
#
# Toggles:
#   CTK_HOOK_PERSONA_INJECT=0    skip persona injection
#   CTK_HOOK_REGISTRY_INJECT=0   skip registry injection

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

command -v jq >/dev/null 2>&1 || exit 0
cat >/dev/null 2>&1 || true  # drain stdin; agent_type not needed for injection

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
[[ -n "$INJECTION" ]] || exit 0

jq -n --arg ctx "$INJECTION" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStart",
    additionalContext: $ctx
  }
}'
exit 0
