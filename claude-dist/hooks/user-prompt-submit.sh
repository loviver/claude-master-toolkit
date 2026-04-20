#!/usr/bin/env bash
# claude-master-toolkit: UserPromptSubmit hook
# - Task switch guard: /task <name> requires clean git
# - SDD init guard: /sdd-* requires .ctk/init.marker
# - Context warnings: 70/85/95% thresholds

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

# Read stdin ONCE, reuse via variables (stdin cannot be re-read)
INPUT_JSON="$(cat 2>/dev/null || true)"
USER_PROMPT=""
if [[ -n "$INPUT_JSON" ]] && command -v jq >/dev/null 2>&1; then
  USER_PROMPT="$(echo "$INPUT_JSON" | jq -r '.prompt // ""' 2>/dev/null || echo "")"
fi

# --- Task Switch Guard ------------------------------------------------------
if [[ -n "$USER_PROMPT" ]] && echo "$USER_PROMPT" | grep -qE '^/task\s+'; then
  TASK_NAME="$(echo "$USER_PROMPT" | sed -E 's|^/task\s+||' | head -c 200)"
  if git status --porcelain 2>/dev/null | grep -q .; then
    printf '\n❌ Task switch blocked: git dirty\n' >&2
    printf '   Commit current work antes de /task\n\n' >&2
    exit 1
  fi
  mkdir -p .ctk
  echo "$TASK_NAME" > .ctk/current-task.txt
  printf '\n✓ Task: %s\n\n' "$TASK_NAME"
  exit 0
fi

# --- SDD Init Guard ---------------------------------------------------------
# If prompt invokes an sdd-* command and .ctk/init.marker is missing, inject
# a hint. Non-blocking — orchestrator's SDD Init Guard completes the flow.
if [[ -n "$USER_PROMPT" ]] && command -v jq >/dev/null 2>&1; then
  if echo "$USER_PROMPT" | grep -qE '^/?sdd-(new|ff|continue|explore|propose|spec|design|tasks|apply|verify|archive|onboard)\b'; then
    if ! ctk_lib_init_done "${CLAUDE_PROJECT_DIR:-$PWD}"; then
      jq -n '{
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "⚠ ctk init required — .ctk/init.marker missing for this project. Run `ctk init` (or let sdd-orchestrator run sdd-init) before continuing."
        }
      }'
      exit 0
    fi
  fi
fi

# --- Context Window Warnings ------------------------------------------------
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
