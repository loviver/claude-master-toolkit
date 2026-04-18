#!/usr/bin/env bash
# claude-master-toolkit: SessionStart hook
# 1. Warns about prior session token accumulation in this cwd.
# 2. Emits ctk tools reminder.
# 3. Purges stale state files (>7 days).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

context_guardian() {
  local session_file model limit tokens pct fmt
  session_file="$(ctk_lib_session_file)"
  [[ -n "$session_file" ]] || return 0

  tokens="$(ctk_lib_last_turn_tokens "$session_file")"
  [[ "$tokens" -gt 0 ]] || return 0

  model="$(ctk_lib_main_model)"
  limit="$(ctk_lib_context_limit "$model")"
  pct="$(ctk_lib_context_pct "$tokens" "$limit")"

  (( pct >= 60 )) || return 0

  fmt=$(printf "%'d" "$tokens" 2>/dev/null || echo "$tokens")

  local cost_line=""
  if command -v ctk >/dev/null 2>&1; then
    local cost
    cost=$(ctk cost --quiet 2>/dev/null || echo "")
    [[ -n "$cost" ]] && cost_line="   Est. realized cost: \$${cost} (${model})"$'\n'
  fi

  printf '\n'
  printf '⚠  Context Guardian — prior session in this project\n'
  printf '   Accumulated tokens: %s (%d%% of %s window)\n' "$fmt" "$pct" "$limit"
  [[ -n "$cost_line" ]] && printf '%s' "$cost_line"
  if (( pct >= 85 )); then
    printf '   Recommendation: /clear (new task) — this session is near saturation\n'
  elif (( pct >= 70 )); then
    printf '   Recommendation: /compact (continuing same work) or /clear (new task)\n'
  else
    printf '   Recommendation: monitor usage; /compact if approaching 70%%\n'
  fi
  printf '   Note: Claude cache TTL (5 min) is NOT context expiry — tokens persist.\n\n'
}

ctk_reminder() {
  command -v ctk >/dev/null 2>&1 || return 0
  echo "ctk MCP active — tools: ctk_understand, ctk_find, ctk_deps, ctk_callers, ctk_slice, ctk_recall, ctk_record, ctk_brief_read, ctk_brief_validate. Prefer over Read. Use /delegate for Agent calls."
}

pandorica_reminder() {
  command -v ctk >/dev/null 2>&1 || return 0
  local recent
  recent="$(ctk --json pandorica recent --limit 3 2>/dev/null || true)"
  echo "Pandorica active — persistent memory vault. Tools: pandorica_save / _search / _context / _session_summary / _recent. SAVE PROACTIVELY after decisions, bugfixes, non-obvious discoveries."
  if [[ -n "$recent" ]]; then
    printf '   Recent memories (this project): %s\n' "$(echo "$recent" | head -c 300)"
  fi
}

ctk_lib_purge_stale_state 7
context_guardian
ctk_reminder
pandorica_reminder
