#!/usr/bin/env bash
# claude-master-toolkit: UserPromptSubmit hook
# Warns once per threshold crossing (70 / 85 / 95 %) during live session.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

SESSION_FILE="$(ctk_lib_session_file)"
[[ -n "$SESSION_FILE" ]] || exit 0

TOKENS="$(ctk_lib_last_turn_tokens "$SESSION_FILE")"
[[ "$TOKENS" -gt 0 ]] || exit 0

MODEL="$(ctk_lib_main_model)"
LIMIT="$(ctk_lib_context_limit "$MODEL")"
PCT="$(ctk_lib_context_pct "$TOKENS" "$LIMIT")"

STATE_DIR="$(ctk_lib_state_dir)"
SESSION_KEY="$(basename "$SESSION_FILE" .jsonl)"
STATE_FILE="$STATE_DIR/$SESSION_KEY.warned"
touch "$STATE_FILE"

warn_once() {
  local level="$1" msg="$2"
  grep -q "^$level$" "$STATE_FILE" 2>/dev/null && return 0
  echo "$level" >> "$STATE_FILE"

  printf '\n⚠  Context Guardian: %s\n' "$msg"
  printf '   Usage: %d%% (approx %s tokens of %s)\n' "$PCT" "$TOKENS" "$LIMIT"
  if command -v ctk >/dev/null 2>&1; then
    local cost
    cost=$(ctk cost --quiet 2>/dev/null || echo "")
    [[ -n "$cost" ]] && printf '   Realized cost: $%s (%s)\n' "$cost" "$MODEL"
  fi
  printf '\n'
}

if (( PCT >= 95 )); then
  warn_once "95" "CRITICAL — run /compact NOW or risk truncation"
elif (( PCT >= 85 )); then
  warn_once "85" "HIGH — /compact recommended before next large operation"
elif (( PCT >= 70 )); then
  warn_once "70" "threshold crossed — plan a /compact soon"
fi

exit 0
