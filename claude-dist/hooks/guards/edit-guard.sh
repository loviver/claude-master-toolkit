#!/usr/bin/env bash
# claude-master-toolkit: Edit/Write/MultiEdit PreToolUse guard
# Non-blocking. Scans .ctk/skill-registry.md for trigger matches against the
# target file_path and emits skill-load hints via additionalContext.
#
# Toggle: CTK_HOOK_EDIT_SKILL_INJECT=0 disables.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib.sh
source "$SCRIPT_DIR/../lib.sh"

if [[ "${CTK_HOOK_EDIT_SKILL_INJECT:-1}" == "0" ]]; then
  exit 0
fi

INPUT="$(cat)"
command -v jq >/dev/null 2>&1 || exit 0
FILE_PATH="$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')"
[[ -n "$FILE_PATH" ]] || exit 0

REGISTRY="${CLAUDE_PROJECT_DIR:-$PWD}/.ctk/skill-registry.md"
[[ -f "$REGISTRY" ]] || exit 0

# Registry row shape (per skill-registry.ts render):
#   | name | triggers | path | summary |
# triggers is a comma-separated list of glob-ish patterns.
HINTS=""
while IFS='|' read -r _ name triggers _rest; do
  name="$(echo "$name" | xargs)"
  triggers="$(echo "$triggers" | xargs)"
  [[ -z "$name" || "$name" == "name" || "$name" =~ ^-+$ ]] && continue
  [[ -z "$triggers" || "$triggers" == "-" ]] && continue
  IFS=',' read -ra PATTERNS <<< "$triggers"
  for pat in "${PATTERNS[@]}"; do
    pat="$(echo "$pat" | xargs)"
    [[ -z "$pat" ]] && continue
    # shellcheck disable=SC2053
    if [[ "$FILE_PATH" == $pat ]]; then
      HINTS+="[ctk-skill-hint] load $name (trigger: $pat)"$'\n'
      break
    fi
  done
done < "$REGISTRY"

[[ -z "$HINTS" ]] && exit 0

jq -n --arg ctx "$HINTS" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    additionalContext: $ctx
  }
}'
exit 0
