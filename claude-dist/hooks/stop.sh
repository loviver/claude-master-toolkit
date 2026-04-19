#!/usr/bin/env bash
# claude-master-toolkit: Stop hook
# Fires when Claude finishes responding. Emits (non-blocking) reminders:
#   - If the turn had Edits/Writes, suggest ctk_record + pandorica_save.
#   - If ≥N turns since last pandorica_session_summary, suggest summary.
#
# Never blocks (exit 0). Uses Stop's "systemMessage" JSON field for user-visible
# warnings and "hookSpecificOutput.additionalContext" is NOT part of Stop's schema,
# so we use plain stderr (shown to user, not Claude) to keep it quiet.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

# Read stdin (optional — Claude may pass JSON).
INPUT="$(cat 2>/dev/null || echo '{}')"
command -v jq >/dev/null 2>&1 || exit 0

SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""')"
TRANSCRIPT="$(echo "$INPUT" | jq -r '.transcript_path // ""')"
[[ -n "$TRANSCRIPT" && -f "$TRANSCRIPT" ]] || exit 0

# Count Edit/Write tool uses in this session.
EDITS="$(grep -cE '"name":"(Edit|Write|MultiEdit|NotebookEdit)"' "$TRANSCRIPT" 2>/dev/null || echo 0)"
EDITS="${EDITS//[^0-9]/}"
EDITS="${EDITS:-0}"

# Check if any mem_save / pandorica_save was called this session.
PANDORICA_SAVES="$(grep -cE '"name":"(mem_save|pandorica_save)"' "$TRANSCRIPT" 2>/dev/null || echo 0)"
PANDORICA_SAVES="${PANDORICA_SAVES//[^0-9]/}"
PANDORICA_SAVES="${PANDORICA_SAVES:-0}"

# Count ctk_record calls.
CTK_RECORDS="$(grep -cE '"name":"ctk_record"' "$TRANSCRIPT" 2>/dev/null || echo 0)"
CTK_RECORDS="${CTK_RECORDS//[^0-9]/}"
CTK_RECORDS="${CTK_RECORDS:-0}"

THRESHOLD="${CTK_HOOK_SAVE_THRESHOLD:-3}"
STRICT="${CTK_HOOK_SAVE_STRICT:-0}"

# Silent if nothing happened worth remembering.
if (( EDITS < THRESHOLD )); then
  exit 0
fi

# De-dupe: state file tracks whether we already nagged this session.
STATE_DIR="$(ctk_lib_state_dir)"
NAG_FILE="$STATE_DIR/${SESSION_ID:-unknown}.nagged"
[[ -f "$NAG_FILE" ]] && exit 0

# Craft reminder only if both persistence mechanisms were neglected.
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
