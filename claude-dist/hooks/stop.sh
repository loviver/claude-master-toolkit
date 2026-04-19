#!/usr/bin/env bash
# claude-master-toolkit: Stop hook
# Fires when Claude finishes responding.
#
# Two responsibilities (independent, decoupled):
#   1. SYNC — POST sessionId to /api/sessions/sync. Runs EVERY turn, no gates.
#   2. NAG  — stderr hint when edits ≥ THRESHOLD and no memory save. Once per session.
#
# Bug fixed: sync used to exit early if .nagged or edits < threshold.
# Now sync runs unconditionally first, then nag logic is separate.
#
# Debug: export CTK_HOOK_DEBUG=1 → appends to $STATE_DIR/hooks-debug.log
# Check with: tail -f ~/.claude/state/claude-master-toolkit/hooks-debug.log

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

INPUT="$(cat 2>/dev/null || echo '{}')"
command -v jq >/dev/null 2>&1 || exit 0

SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""')"
TRANSCRIPT="$(echo "$INPUT" | jq -r '.transcript_path // ""')"

STATE_DIR="$(ctk_lib_state_dir)"
mkdir -p "$STATE_DIR"

debug_log() {
  [[ "${CTK_HOOK_DEBUG:-0}" == "1" ]] || return 0
  local msg="$1"
  mkdir -p "$STATE_DIR"
  echo "[$(date -Iseconds)] stop: sid=${SESSION_ID:-?} $msg" >> "$STATE_DIR/hooks-debug.log"
}

# ─── 1. SYNC (always, no gates) ──────────────────────────────────────────
if [[ -n "$SESSION_ID" ]] && command -v curl >/dev/null 2>&1; then
  CTK_PORT="${CTK_PORT:-3200}"
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST "http://localhost:${CTK_PORT}/api/sessions/sync" \
    -H "Content-Type: application/json" \
    -d "{\"sessionId\":\"${SESSION_ID}\"}" \
    --max-time 2 2>/dev/null || echo "000")"
  debug_log "sync http=$HTTP_CODE"
fi

# ─── 2. NAG (gated by edits threshold + dedup) ───────────────────────────
[[ -n "$TRANSCRIPT" && -f "$TRANSCRIPT" ]] || { debug_log "no transcript, skip nag"; exit 0; }

EDITS="$(grep -cE '"name":"(Edit|Write|MultiEdit|NotebookEdit)"' "$TRANSCRIPT" 2>/dev/null || echo 0)"
EDITS="${EDITS//[^0-9]/}"; EDITS="${EDITS:-0}"

PANDORICA_SAVES="$(grep -cE '"name":"(mem_save|pandorica_save)"' "$TRANSCRIPT" 2>/dev/null || echo 0)"
PANDORICA_SAVES="${PANDORICA_SAVES//[^0-9]/}"; PANDORICA_SAVES="${PANDORICA_SAVES:-0}"

CTK_RECORDS="$(grep -cE '"name":"ctk_record"' "$TRANSCRIPT" 2>/dev/null || echo 0)"
CTK_RECORDS="${CTK_RECORDS//[^0-9]/}"; CTK_RECORDS="${CTK_RECORDS:-0}"

THRESHOLD="${CTK_HOOK_SAVE_THRESHOLD:-3}"
STRICT="${CTK_HOOK_SAVE_STRICT:-0}"

debug_log "edits=$EDITS saves=$PANDORICA_SAVES records=$CTK_RECORDS threshold=$THRESHOLD"

(( EDITS < THRESHOLD )) && exit 0

NAG_FILE="$STATE_DIR/${SESSION_ID:-unknown}.nagged"
[[ -f "$NAG_FILE" ]] && { debug_log "already nagged, skip"; exit 0; }

if (( PANDORICA_SAVES == 0 && CTK_RECORDS == 0 )); then
  touch "$NAG_FILE"
  REASON="$EDITS edit(s) this session but 0 mem_save / 0 ctk_record calls (threshold=$THRESHOLD)."
  if [[ "$STRICT" == "1" ]]; then
    cat >&2 <<EOF

✗ Blocked Stop: $REASON
   Save context before ending the turn:
     • mem_save — structured, cost-aware memory (Pandorica v2, FTS5)
     • ctk_record — shared finding pool for sub-agents
   Override once: rm $NAG_FILE  (or CTK_HOOK_SAVE_STRICT=0)
EOF
    exit 2
  fi
  cat >&2 <<EOF

↪  Session hint: $REASON
   If any edit represents a decision, bugfix, discovery, or convention:
     • mem_save — structured, cost-aware memory (Pandorica v2, FTS5)
     • ctk_record — shared finding pool for sub-agents
   Skip this reminder next time with: touch $NAG_FILE
EOF
fi

exit 0
