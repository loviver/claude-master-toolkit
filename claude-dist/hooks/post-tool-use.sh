#!/usr/bin/env bash
# claude-master-toolkit: PostToolUse hook — incremental AST reindex.
# After an Edit/Write/MultiEdit to a source file in a ctk-active project, refresh
# the symbol index (which ODD risk routing reads) so it never goes stale. Runs
# detached in the background: zero turn latency. A non-blocking flock means
# concurrent edits don't pile up parallel SQLite writers — if a reindex is
# already running the new one just skips (the index self-heals on the next edit).
#
# Toggle off: CTK_HOOK_REINDEX=0. Test seam: CTK_REINDEX_SYNC=1 runs inline.

set -euo pipefail

# shellcheck source=./ts-shim.sh
source "$(dirname "${BASH_SOURCE[0]}")/ts-shim.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

# Fail-open: no jq or disabled → do nothing, never block the turn.
[[ "${CTK_HOOK_REINDEX:-1}" == "0" ]] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v ctk >/dev/null 2>&1 || exit 0

INPUT="$(cat)"
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // ""')"
case "$TOOL_NAME" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

FILE="$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')"
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.go|*.rs) ;;
  *) exit 0 ;;
esac

CWD="$(echo "$INPUT" | jq -r '.cwd // ""')"
[[ -n "$CWD" ]] || CWD="${CLAUDE_PROJECT_DIR:-$PWD}"

# Only touch projects the user has activated ctk on (avoids bootstrapping a full
# index in a random repo they happen to edit a file in).
ctk_lib_init_done "$CWD" || exit 0

ctk_lib_reindex "$CWD"
