#!/usr/bin/env bash
# claude-master-toolkit: SessionEnd hook
# Display-only, ~1.5s budget. The model is gone — no AI summary is possible
# here (that is PreCompact's job, while the model is still live). Mechanical
# work only:
#   1. Final, best-effort session sync to the API (same pattern as stop.sh).
#   2. On reason=clear|logout, purge THIS session's state (.nagged + per-session
#      counters/agent-steps). Complements the time-based 7-day purge in
#      SessionStart.

set -euo pipefail

# shellcheck source=./ts-shim.sh
source "$(dirname "${BASH_SOURCE[0]}")/ts-shim.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

INPUT="$(cat 2>/dev/null || echo '{}')"
command -v jq >/dev/null 2>&1 || exit 0

SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""')"
REASON="$(echo "$INPUT" | jq -r '.reason // "other"')"

# 1. Final sync (best-effort, tight timeout to respect the 1.5s budget).
if [[ -n "$SESSION_ID" ]] && command -v curl >/dev/null 2>&1; then
  CTK_PORT="${CTK_PORT:-3200}"
  curl -s -o /dev/null \
    -X POST "http://localhost:${CTK_PORT}/api/sessions/sync" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":\"${SESSION_ID}\"}" \
    --max-time 1 2>/dev/null || true
fi

# 2. Clean up this session's state on a clean task boundary.
if [[ -n "$SESSION_ID" && ( "$REASON" == "clear" || "$REASON" == "logout" ) ]]; then
  STATE_DIR="$(ctk_lib_state_dir)"
  rm -f  "$STATE_DIR/${SESSION_ID}.nagged" 2>/dev/null || true
  rm -rf "$STATE_DIR/${SESSION_ID}"        2>/dev/null || true
fi

exit 0
