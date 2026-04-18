#!/usr/bin/env bash
# claude-master-toolkit: PreCompact hook
# Fires before context compaction. Injects a reminder so the assistant calls
# pandorica_session_summary BEFORE the conversation is truncated — otherwise
# mid-session discoveries evaporate.
#
# Never blocks compaction (exit 0). Uses systemMessage for a visible note.

set -euo pipefail

command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat 2>/dev/null || echo '{}')"
REASON="$(echo "$INPUT" | jq -r '.compaction_reason // "unknown"')"

jq -n --arg reason "$REASON" '{
  systemMessage: ("⏳ Compaction (" + $reason + ") imminent. Call pandorica_session_summary NOW to persist this session before the window is compressed.")
}'
exit 0
