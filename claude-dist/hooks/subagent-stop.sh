#!/usr/bin/env bash
# claude-master-toolkit: SubagentStop hook
# Fires when a sub-agent finishes. The event exposes agent_type +
# last_assistant_message but NOT the sub-agent's transcript, so we cannot count
# its mem_save / ctk_record calls the way stop.sh does for the main thread.
# This is therefore a light reminder, not an exact check.
#
# Opt-in: default OFF to avoid noise. Enable with CTK_HOOK_SUBAGENT_NAG=1.
# Non-blocking.

set -euo pipefail

# shellcheck source=./ts-shim.sh
source "$(dirname "${BASH_SOURCE[0]}")/ts-shim.sh"

[[ "${CTK_HOOK_SUBAGENT_NAG:-0}" == "1" ]] || exit 0

command -v jq >/dev/null 2>&1 || exit 0
INPUT="$(cat 2>/dev/null || echo '{}')"
AGENT_TYPE="$(echo "$INPUT" | jq -r '.agent_type // ""')"

# Only remind for agent types that typically produce changes/findings worth
# consolidating. Read-only / mechanical agents are skipped.
case "$AGENT_TYPE" in
  sdd-apply|general-purpose|cavecrew-builder) ;;
  *) exit 0 ;;
esac

CTX="Sub-agent '$AGENT_TYPE' finished. If it produced a decision, bugfix, convention, or non-obvious discovery, consolidate it now: mem_save (structured, cost-aware memory) or ctk_record (shared finding pool for sub-agents)."

jq -n --arg ctx "$CTX" '{
  hookSpecificOutput: {
    hookEventName: "SubagentStop",
    additionalContext: $ctx
  }
}'
exit 0
