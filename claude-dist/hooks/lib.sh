#!/usr/bin/env bash
# claude-master-toolkit: shared hook utilities.
# Sourced by event hooks. Keep fast — every function <50ms.

# Absolute context window per model (input tokens).
# Overridable via $CLAUDE_CONTEXT_WINDOW env var for 1M-beta setups.
ctk_lib_context_limit() {
  if [[ -n "${CLAUDE_CONTEXT_WINDOW:-}" ]]; then
    echo "${CLAUDE_CONTEXT_WINDOW}"
    return 0
  fi
  local model="${1:-}"
  case "$model" in
    *opus*)   echo 200000 ;;
    *sonnet*) echo 200000 ;;  # Sonnet 1M is beta opt-in; default stays 200k
    *haiku*)  echo 200000 ;;
    *)        echo 200000 ;;
  esac
}

# Read the configured main model from settings.json.
# Fallback: "sonnet" if jq missing or file absent.
ctk_lib_main_model() {
  local settings="$HOME/.claude/settings.json"
  [[ -f "$settings" ]] || { echo "sonnet"; return 0; }
  if command -v jq >/dev/null 2>&1; then
    jq -r '.model // "sonnet"' "$settings" 2>/dev/null || echo "sonnet"
  else
    echo "sonnet"
  fi
}

# Resolve the session JSONL for the current cwd (or a given cwd).
# Echoes the path; empty string if none.
ctk_lib_session_file() {
  local cwd="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}"
  local session_id="${CLAUDE_SESSION_ID:-}"
  local encoded proj_dir
  encoded="$(printf '%s' "$cwd" | sed 's|/|-|g')"
  proj_dir="$HOME/.claude/projects/$encoded"
  [[ -d "$proj_dir" ]] || { echo ""; return 0; }

  if [[ -n "$session_id" && -f "$proj_dir/$session_id.jsonl" ]]; then
    echo "$proj_dir/$session_id.jsonl"
  else
    find "$proj_dir" -maxdepth 1 -name '*.jsonl' -type f -printf '%T@ %p\n' 2>/dev/null \
      | sort -rn | head -1 | awk '{print $2}'
  fi
}

# Extract last-turn token occupancy from a session JSONL.
# Echoes: "<total_tokens>"
ctk_lib_last_turn_tokens() {
  local session_file="$1"
  [[ -f "$session_file" ]] || { echo 0; return 0; }
  local last_line li lo lcr
  last_line="$(tac "$session_file" 2>/dev/null | grep -m 1 '"input_tokens"' || true)"
  [[ -n "$last_line" ]] || { echo 0; return 0; }
  li="$(echo  "$last_line" | grep -oE '"input_tokens":[0-9]+' | head -1 | cut -d: -f2)"
  lo="$(echo  "$last_line" | grep -oE '"output_tokens":[0-9]+' | head -1 | cut -d: -f2)"
  lcr="$(echo "$last_line" | grep -oE '"cache_read_input_tokens":[0-9]+' | head -1 | cut -d: -f2)"
  echo $(( ${li:-0} + ${lo:-0} + ${lcr:-0} ))
}

# Percentage of the context window used (0-100+).
ctk_lib_context_pct() {
  local tokens="$1" limit="$2"
  [[ "$limit" -gt 0 ]] || { echo 0; return 0; }
  echo $(( tokens * 100 / limit ))
}

# State dir for cross-hook persistence. Created lazy.
ctk_lib_state_dir() {
  local d="$HOME/.claude/state/claude-master-toolkit"
  mkdir -p "$d"
  echo "$d"
}

# Purge stale state files older than N days (default 7).
ctk_lib_purge_stale_state() {
  local days="${1:-7}" dir
  dir="$(ctk_lib_state_dir)"
  find "$dir" -maxdepth 1 -type f -name '*.warned' -mtime "+${days}" -delete 2>/dev/null || true
}
