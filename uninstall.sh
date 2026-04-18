#!/usr/bin/env bash
# claude-master-toolkit: uninstaller
# Removes symlinks, cleans database, restores backups, removes PATH marker.
# Optional: uninstall caveman plugin.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

MARKER_START="# >>> claude-master-toolkit >>>"
MARKER_END="# <<< claude-master-toolkit <<<"

say()  { printf '  %s\n' "$*"; }
head() { printf '\n== %s ==\n' "$*"; }

head "1. Remove symlinks"
for link in "$CLAUDE_DIR/CLAUDE.md" \
            "$CLAUDE_DIR/hooks/session-start.sh" \
            "$CLAUDE_DIR/hooks/user-prompt-submit.sh" \
            "$CLAUDE_DIR/skills/sdd-new" \
            "$CLAUDE_DIR/skills/sdd-ff" \
            "$CLAUDE_DIR/skills/sdd-continue" \
            "$CLAUDE_DIR/skills/pandorica-protocol" \
            "$CLAUDE_DIR/skills/delegate" \
            "$CLAUDE_DIR/agents/sdd-orchestrator.md"; do
  if [[ -L "$link" ]]; then
    rm "$link"
  fi
done
say "removed symlinks (9)"

head "2. Clean up database and state"
STATE_DIR="$HOME/.claude/state/claude-master-toolkit"
if [[ -d "$STATE_DIR" ]]; then
  rm -f "$STATE_DIR/ctk.sqlite" "$STATE_DIR/ctk.sqlite-journal"
  say "cleaned database"
  if [[ -f "$STATE_DIR/model-preference" ]]; then
    rm "$STATE_DIR/model-preference"
  fi
fi

head "3. Restore latest backup"
LATEST_BACKUP="$(find "$CLAUDE_DIR/backups" -maxdepth 1 -type d -name 'cmt-*' 2>/dev/null | sort | tail -1)"
if [[ -n "${LATEST_BACKUP:-}" && -d "$LATEST_BACKUP" ]]; then
  if [[ -f "$LATEST_BACKUP/CLAUDE.md" ]]; then
    cp "$LATEST_BACKUP/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
    say "restored CLAUDE.md"
  fi
  if [[ -f "$LATEST_BACKUP/settings.json" ]]; then
    cp "$LATEST_BACKUP/settings.json" "$CLAUDE_DIR/settings.json"
    say "restored settings.json"
  fi
else
  say "no backup found"
fi

head "4. Remove ctk from PATH"
LOCAL_BIN_LINK="$HOME/.local/bin/ctk"
if [[ -L "$LOCAL_BIN_LINK" ]]; then
  rm "$LOCAL_BIN_LINK"
  say "removed symlink $LOCAL_BIN_LINK"
fi
if grep -q "$MARKER_START" "$HOME/.bashrc" 2>/dev/null; then
  sed -i.cmtbak "/$MARKER_START/,/$MARKER_END/d" "$HOME/.bashrc"
  say "removed PATH block from ~/.bashrc"
fi

head "5. Unlink ctk global"
if command -v pnpm >/dev/null 2>&1; then
  (cd "$REPO_DIR" && pnpm unlink --global >/dev/null 2>&1) || true
  say "pnpm unlink --global done"
fi
if command -v npm >/dev/null 2>&1; then
  npm unlink -g claude-master-toolkit >/dev/null 2>&1 || true
fi

head "6. Clean up node_modules (optional)"
read -rp "  Remove node_modules to save space? [y/N] " reply
if [[ "${reply:-N}" =~ ^[Yy]$ ]]; then
  if [[ -d "$REPO_DIR/node_modules" ]]; then
    rm -rf "$REPO_DIR/node_modules"
    say "removed node_modules"
  fi
else
  say "node_modules kept"
fi

head "7. Caveman plugin"
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

  Backup location: $CLAUDE_DIR/backups/
  To reinstall:    cd $REPO_DIR && ./install.sh

Reload your shell: source ~/.bashrc

EOF
