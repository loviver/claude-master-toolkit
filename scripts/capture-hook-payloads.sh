#!/usr/bin/env bash
# Dumps the stdin JSON of any agent hook (Codex or Claude Code) into a fixture file.
# Usage (registered as hook command): capture-hook-payloads.sh <agent> <event>
# Always exits 0 and prints nothing, so it never alters agent behaviour.
set -u

agent="${1:-unknown}"
event="${2:-unknown}"
dir="${CTK_CAPTURE_DIR:-$HOME/.ctk/captures}/$agent"
mkdir -p "$dir" 2>/dev/null || exit 0

ts="$(date +%Y%m%dT%H%M%S%N)"
cat > "$dir/${event}-${ts}.json" 2>/dev/null

# Record the env vars the agent exposes to hooks (names only for session/project hints).
env | grep -E '^(CODEX|CLAUDE|CTK)_' | sed -E 's/=.*/=<redacted>/' \
  > "$dir/${event}-${ts}.env" 2>/dev/null

exit 0
