#!/usr/bin/env bash
# ctk statusline — reads SQLite directly (SWR: cached, no HTTP, no JSONL parse).
# Renders: $today · $session · model
# Fails silent: on any error, emit empty string so Claude Code statusline degrades gracefully.

set -eu

DB="${CTK_DB_PATH:-$HOME/.claude/state/claude-master-toolkit/ctk.sqlite}"

if [[ ! -f "$DB" ]] || ! command -v sqlite3 >/dev/null 2>&1; then
  echo ""
  exit 0
fi

# Claude Code injects JSON on stdin describing the session.
INPUT="$(cat 2>/dev/null || true)"
SESSION_ID=""
MODEL=""
if command -v jq >/dev/null 2>&1 && [[ -n "$INPUT" ]]; then
  SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // .sessionId // empty' 2>/dev/null || true)"
  MODEL="$(echo "$INPUT" | jq -r '.model.display_name // .model.id // .model // empty' 2>/dev/null || true)"
fi

# Day window (local TZ) — SQLite stores ms epoch.
DAY_START_MS="$(date -d 'today 00:00:00' +%s 2>/dev/null || date -j -f '%Y-%m-%d %H:%M:%S' "$(date +%Y-%m-%d) 00:00:00" +%s)000"

TODAY_COST="$(sqlite3 "$DB" "SELECT printf('%.2f', COALESCE(SUM(total_cost_usd), 0)) FROM sessions WHERE last_active_at >= $DAY_START_MS;" 2>/dev/null || echo "0.00")"

SESSION_COST="0.00"
if [[ -n "$SESSION_ID" ]]; then
  SESSION_COST="$(sqlite3 "$DB" "SELECT printf('%.2f', COALESCE(total_cost_usd, 0)) FROM sessions WHERE id='${SESSION_ID//\'/}';" 2>/dev/null || echo "0.00")"
  [[ -z "$SESSION_COST" ]] && SESSION_COST="0.00"
fi

OUT="\$${TODAY_COST} today · \$${SESSION_COST} session"
[[ -n "$MODEL" ]] && OUT="$OUT · $MODEL"
echo "$OUT"
