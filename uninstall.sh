#!/usr/bin/env bash
# claude-master-toolkit: uninstaller
# Removes agent stacks (manifest-based), removes PATH marker. Database is kept unless --purge-data.
# Optional: uninstall caveman plugin.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

MARKER_START="# >>> claude-master-toolkit >>>"
MARKER_END="# <<< claude-master-toolkit <<<"

say()  { printf '  %s\n' "$*"; }
head() { printf '\n== %s ==\n' "$*"; }

head "1. Remove agent stacks (Claude Code + Codex)"
# The manifest-based uninstaller removes exactly what `ctk install` added for each agent,
# leaves user hooks/settings/skills alone and never touches shared state in ~/.ctk.
if command -v ctk >/dev/null 2>&1; then
  ctk uninstall all || say "ctk uninstall all failed (see above); continuing"
else
  say "ctk not found on PATH: agent stacks NOT removed (reinstall ctk, run 'ctk uninstall all', then re-run)"
fi

head "2. Shared data (~/.ctk)"
# The database and memories are shared by Claude Code and Codex: kept unless explicitly purged.
STATE_DIR="${CTK_HOME:-$HOME/.ctk}"
LEGACY_STATE_DIR="$HOME/.claude/state/claude-master-toolkit"
if [[ "${1:-}" == "--purge-data" ]]; then
  if [[ -d "$STATE_DIR" ]]; then
    rm -f "$STATE_DIR/ctk.sqlite" "$STATE_DIR/ctk.sqlite-wal" "$STATE_DIR/ctk.sqlite-shm" "$STATE_DIR/ctk.sqlite-journal"
    rm -f "$STATE_DIR/model-preference"
    say "purged database + preferences in $STATE_DIR"
  fi
else
  say "kept $STATE_DIR (database + memories). Use: ./uninstall.sh --purge-data to delete"
fi
if [[ -L "$LEGACY_STATE_DIR" ]]; then
  rm "$LEGACY_STATE_DIR"
  say "removed legacy state symlink"
fi

head "3. Remove ctk from PATH"
LOCAL_BIN_LINK="$HOME/.local/bin/ctk"
if [[ -L "$LOCAL_BIN_LINK" ]]; then
  rm "$LOCAL_BIN_LINK"
  say "removed symlink $LOCAL_BIN_LINK"
fi
if grep -q "$MARKER_START" "$HOME/.bashrc" 2>/dev/null; then
  sed -i.cmtbak "/$MARKER_START/,/$MARKER_END/d" "$HOME/.bashrc"
  say "removed PATH block from ~/.bashrc"
fi

head "4. Unlink ctk global"
if command -v pnpm >/dev/null 2>&1; then
  (cd "$REPO_DIR" && pnpm unlink --global >/dev/null 2>&1) || true
  say "pnpm unlink --global done"
fi
if command -v npm >/dev/null 2>&1; then
  npm unlink -g claude-master-toolkit >/dev/null 2>&1 || true
fi

head "5. Clean up node_modules (optional)"
read -rp "  Remove node_modules to save space? [y/N] " reply
if [[ "${reply:-N}" =~ ^[Yy]$ ]]; then
  if [[ -d "$REPO_DIR/node_modules" ]]; then
    rm -rf "$REPO_DIR/node_modules"
    say "removed node_modules"
  fi
else
  say "node_modules kept"
fi

head "6. Caveman plugin"
read -rp "  Uninstall caveman plugin too? [y/N] " reply
if [[ "${reply:-N}" =~ ^[Yy]$ ]]; then
  if command -v claude >/dev/null 2>&1; then
    claude plugin uninstall caveman@caveman 2>/dev/null || say "caveman not installed"
    say "caveman uninstalled"
  fi
else
  say "caveman left installed"
fi

head "✓ Uninstalled"
cat <<EOF

claude-master-toolkit removed.

  Backups:         ${CTK_HOME:-$HOME/.ctk}/backups/
  To reinstall:    cd $REPO_DIR && ./install.sh

Reload your shell: source ~/.bashrc

EOF
