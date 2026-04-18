#!/usr/bin/env bash
# claude-master-toolkit: PreToolUse hook (dispatcher)
# Routes to per-tool guards based on tool_name from stdin JSON.
# Exit 2 denies; stderr is shown to Claude so it self-corrects.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

# Read stdin JSON once. If jq is unavailable, allow everything (fail-open).
command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat)"
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // ""')"

case "$TOOL_NAME" in
  Bash)  exec bash "$SCRIPT_DIR/guards/bash-guard.sh" <<< "$INPUT" ;;
  Agent) exec bash "$SCRIPT_DIR/guards/agent-guard.sh" <<< "$INPUT" ;;
  *)     exit 0 ;;
esac
