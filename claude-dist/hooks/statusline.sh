#!/usr/bin/env bash
# ctk statusline — SWR (stale-while-revalidate).
# Render path is a plain `cat` of a cache file: instant, never blocks on node.
# A background `ctk statusline` refresh (better-sqlite3, the same driver
# Pandorica uses) repopulates the cache. No external `sqlite3` CLI dependency.
# Fails silent: emits empty string on any gap so the statusline degrades cleanly.

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

STATE="$(ctk_lib_state_dir)"
CACHE="$STATE/statusline.cache"
LOCK="$STATE/statusline.lock"
STALE_SECS="${CTK_STATUSLINE_TTL:-3}"

# Claude Code injects session JSON on stdin — capture once, reuse for refresh.
INPUT="$(cat 2>/dev/null || true)"

# 1) Serve cache instantly (may be one render stale — that is the SWR contract).
[[ -f "$CACHE" ]] && cat "$CACHE"

# ctk must be resolvable to refresh; without it, we already served what we had.
command -v ctk >/dev/null 2>&1 || exit 0

mtime_of() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }
now="$(date +%s)"

# Drop a stale lock (a prior refresh that died before releasing it).
if [[ -d "$LOCK" ]]; then
  (( now - $(mtime_of "$LOCK") >= 30 )) && rmdir "$LOCK" 2>/dev/null || true
fi

# 2) Refresh in background only if cache is missing or older than STALE_SECS,
#    deduped by an atomic mkdir lock so frequent renders don't fan out node.
needs_refresh=0
if [[ ! -f "$CACHE" ]]; then
  needs_refresh=1
elif (( now - $(mtime_of "$CACHE") >= STALE_SECS )); then
  needs_refresh=1
fi

if [[ "$needs_refresh" -eq 1 ]] && mkdir "$LOCK" 2>/dev/null; then
  (
    printf '%s' "$INPUT" | ctk statusline > "$CACHE.tmp" 2>/dev/null && mv "$CACHE.tmp" "$CACHE"
    rmdir "$LOCK" 2>/dev/null || true
  ) &
fi

exit 0
